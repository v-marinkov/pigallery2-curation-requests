#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_STAGE=""
REMOTE_START_REQUIRED=0
SSH_CONTROL_PATH=""
SSH_MASTER_ACTIVE=0

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./deploy-to-server.sh [--check-config]

Without arguments, build, test, and deploy using the private .env.deploy file.
--check-config  Validate and print resolved settings without SSH or Docker changes.
EOF
}

case "${1:-}" in
  "") DEPLOY_MODE="deploy" ;;
  --check-config) DEPLOY_MODE="check" ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "Unknown argument: $1"
    ;;
esac
[[ $# -le 1 ]] || fail "Only one argument is supported"

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

load_env_file() {
  local env_file="$1"
  local line key value
  [[ -f "${env_file}" ]] || fail "Deployment settings file does not exist: ${env_file} (copy .env.deploy.example to .env.deploy)"

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    line="$(trim_whitespace "${line}")"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == export\ * ]] && line="${line#export }"
    [[ "${line}" == *=* ]] || fail "Invalid line in ${env_file}: expected KEY=VALUE"

    key="$(trim_whitespace "${line%%=*}")"
    value="$(trim_whitespace "${line#*=}")"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "Invalid setting name in ${env_file}: ${key}"
    if [[ ${#value} -ge 2 && (
      ( "${value:0:1}" == '"' && "${value: -1}" == '"' ) ||
      ( "${value:0:1}" == "'" && "${value: -1}" == "'" )
    ) ]]; then
      value="${value:1:${#value}-2}"
    fi

    # Explicit process environment values take precedence over the file.
    if [[ ! -v "${key}" ]]; then
      printf -v "${key}" '%s' "${value}"
    fi
  done < "${env_file}"
}

DEPLOY_ENV_FILE="${PG2_DEPLOY_ENV_FILE:-${SCRIPT_DIR}/.env.deploy}"
load_env_file "${DEPLOY_ENV_FILE}"

DEPLOY_REMOTE="${PG2_DEPLOY_REMOTE:-}"
DEPLOY_BASE="${PG2_DEPLOY_BASE:-}"
DEPLOY_CONTAINER="${PG2_DEPLOY_CONTAINER:-}"
DEPLOY_COMPOSE_DIR="${PG2_DEPLOY_COMPOSE_DIR:-${DEPLOY_BASE}}"
DEPLOY_COMPOSE_SERVICE="${PG2_DEPLOY_COMPOSE_SERVICE:-${DEPLOY_CONTAINER}}"

DEPLOY_EXTENSION_DIR="${PG2_DEPLOY_EXTENSION_DIR:-${DEPLOY_BASE}/config/extensions/curation-requests}"
DEPLOY_CLI_DIR="${PG2_DEPLOY_CLI_DIR:-${DEPLOY_BASE}/curation/cli}"
DEPLOY_CUSTOM_ASSETS_DIR="${PG2_DEPLOY_CUSTOM_ASSETS_DIR:-${DEPLOY_BASE}/custom_assets}"
DEPLOY_CONFIG_FILE="${PG2_DEPLOY_CONFIG_FILE:-${DEPLOY_BASE}/config/config.json}"
DEPLOY_CONTAINER_EXTENSION_DIR="${PG2_DEPLOY_CONTAINER_EXTENSION_DIR:-/app/data/config/extensions/curation-requests}"
DEPLOY_CONTAINER_CURATION_DIR="${PG2_DEPLOY_CONTAINER_CURATION_DIR:-/app/data/curation}"
DEPLOY_CONTAINER_IMAGE_DIR="${PG2_DEPLOY_CONTAINER_IMAGE_DIR:-/app/data/images}"
DEPLOY_CONTAINER_ASSET_PATH="${PG2_DEPLOY_CONTAINER_ASSET_PATH:-/app/dist/en/pg2-curation-script.js}"
DEPLOY_RECREATE_CONTAINER="${PG2_DEPLOY_RECREATE_CONTAINER:-true}"
DEPLOY_INSTALL_DEPENDENCIES="${PG2_DEPLOY_INSTALL_DEPENDENCIES:-true}"

start_remote_container() {
  ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
    set -e
    if docker inspect ${DEPLOY_CONTAINER} >/dev/null 2>&1; then
      docker start ${DEPLOY_CONTAINER} >/dev/null
    else
      cd ${DEPLOY_COMPOSE_DIR}
      if ! test -f compose.yml && ! test -f compose.yaml && ! test -f docker-compose.yml && ! test -f docker-compose.yaml; then
        echo 'ERROR: no Compose file found in ${DEPLOY_COMPOSE_DIR}' >&2
        exit 1
      fi
      if docker compose version >/dev/null 2>&1; then
        docker compose up -d ${DEPLOY_COMPOSE_SERVICE}
      elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose up -d ${DEPLOY_COMPOSE_SERVICE}
      else
        echo 'ERROR: Docker Compose is not installed on the server' >&2
        exit 1
      fi
    fi
  "
}

recreate_remote_container() {
  ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
    set -e
    cd ${DEPLOY_COMPOSE_DIR}
    if docker compose version >/dev/null 2>&1; then
      docker compose up -d --force-recreate ${DEPLOY_COMPOSE_SERVICE}
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose up -d --force-recreate ${DEPLOY_COMPOSE_SERVICE}
    else
      echo 'ERROR: Docker Compose is not installed on the server' >&2
      exit 1
    fi
  "
}

cleanup() {
  local exit_code=$?
  if [[ "${REMOTE_START_REQUIRED}" == "1" ]]; then
    echo "Deployment did not finish; restarting ${DEPLOY_CONTAINER}..." >&2
    start_remote_container >/dev/null || true
  fi
  if [[ "${SSH_MASTER_ACTIVE}" == "1" ]]; then
    ssh -o "ControlPath=${SSH_CONTROL_PATH}" -O exit "${DEPLOY_REMOTE}" \
      >/dev/null 2>&1 || true
    SSH_MASTER_ACTIVE=0
  fi
  if [[ -n "${DEPLOY_STAGE}" && -d "${DEPLOY_STAGE}" ]]; then
    rm -rf -- "${DEPLOY_STAGE}"
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

command -v npm >/dev/null || fail "npm is required locally"
command -v ssh >/dev/null || fail "ssh is required locally"
command -v scp >/dev/null || fail "scp is required locally"

[[ -n "${DEPLOY_REMOTE}" ]] || fail "PG2_DEPLOY_REMOTE is required in ${DEPLOY_ENV_FILE}"
[[ -n "${DEPLOY_BASE}" ]] || fail "PG2_DEPLOY_BASE is required in ${DEPLOY_ENV_FILE}"
[[ -n "${DEPLOY_CONTAINER}" ]] || fail "PG2_DEPLOY_CONTAINER is required in ${DEPLOY_ENV_FILE}"

for deploy_path in \
  "${DEPLOY_BASE}" \
  "${DEPLOY_COMPOSE_DIR}" \
  "${DEPLOY_EXTENSION_DIR}" \
  "${DEPLOY_CLI_DIR}" \
  "${DEPLOY_CUSTOM_ASSETS_DIR}" \
  "${DEPLOY_CONFIG_FILE}" \
  "${DEPLOY_CONTAINER_EXTENSION_DIR}" \
  "${DEPLOY_CONTAINER_CURATION_DIR}" \
  "${DEPLOY_CONTAINER_IMAGE_DIR}" \
  "${DEPLOY_CONTAINER_ASSET_PATH}"; do
  [[ "${deploy_path}" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "Unsafe absolute deployment path: ${deploy_path}"
  [[ "${deploy_path}" != "/" ]] || fail "Deployment paths must not target the filesystem root"
  [[ "${deploy_path}" != *"//"* ]] || fail "Unsafe absolute deployment path: ${deploy_path}"
  [[ ! "${deploy_path}" =~ (^|/)\.\.?(/|$) ]] || fail "Unsafe absolute deployment path: ${deploy_path}"
done
[[ "${DEPLOY_CONTAINER}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "Unsafe container name: ${DEPLOY_CONTAINER}"
[[ "${DEPLOY_COMPOSE_SERVICE}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "Unsafe Compose service name: ${DEPLOY_COMPOSE_SERVICE}"
[[ "${DEPLOY_RECREATE_CONTAINER}" == "true" || "${DEPLOY_RECREATE_CONTAINER}" == "false" ]] || \
  fail "PG2_DEPLOY_RECREATE_CONTAINER must be true or false"
[[ "${DEPLOY_INSTALL_DEPENDENCIES}" == "true" || "${DEPLOY_INSTALL_DEPENDENCIES}" == "false" ]] || \
  fail "PG2_DEPLOY_INSTALL_DEPENDENCIES must be true or false"
DEPLOY_BROWSER_ASSET_NAME="$(basename -- "${DEPLOY_CONTAINER_ASSET_PATH}")"
[[ "${DEPLOY_BROWSER_ASSET_NAME}" =~ ^[A-Za-z0-9_.-]+$ ]] || \
  fail "Unsafe browser asset filename: ${DEPLOY_BROWSER_ASSET_NAME}"

if [[ "${DEPLOY_MODE}" == "check" ]]; then
  echo "Deployment configuration is valid."
  echo "Environment:         ${DEPLOY_ENV_FILE}"
  echo "SSH destination:     ${DEPLOY_REMOTE}"
  echo "Base directory:      ${DEPLOY_BASE}"
  echo "Compose directory:   ${DEPLOY_COMPOSE_DIR}"
  echo "Compose service:     ${DEPLOY_COMPOSE_SERVICE}"
  echo "Container:           ${DEPLOY_CONTAINER}"
  echo "Extension (host):    ${DEPLOY_EXTENSION_DIR}"
  echo "Extension (container): ${DEPLOY_CONTAINER_EXTENSION_DIR}"
  echo "Curation mount:       ${DEPLOY_CONTAINER_CURATION_DIR}"
  echo "Read-only images:     ${DEPLOY_CONTAINER_IMAGE_DIR}"
  echo "Browser asset mount:  ${DEPLOY_CONTAINER_ASSET_PATH}"
  echo "CLI directory:       ${DEPLOY_CLI_DIR}"
  echo "Custom assets:       ${DEPLOY_CUSTOM_ASSETS_DIR}"
  echo "PiGallery config:    ${DEPLOY_CONFIG_FILE}"
  echo "Recreate container:  ${DEPLOY_RECREATE_CONTAINER}"
  echo "Install dependencies: ${DEPLOY_INSTALL_DEPENDENCIES}"
  echo "Browser asset name:    ${DEPLOY_BROWSER_ASSET_NAME}"
  exit 0
fi

cd "${SCRIPT_DIR}"

RELEASE_VERSION="$(node -p 'require("./package.json").version')"
echo "Building and testing release ${RELEASE_VERSION}..."
npm test

REQUIRED_FILES=(
  package.json
  package-lock.json
  server.js
  config.js
  src/domain.js
  src/db/database.js
  src/db/repository.js
  src/pigallery/adapter.js
  src/security/fingerprint.js
  src/security/paths.js
  cli/pg2-curation-delete
  cli/pg2-curation-review
  cli/pg2_curation_delete.py
  cli/pg2_curation_review.py
  cli/README.md
  cli/.env.example
  custom_assets/pg2-curation-script.js
  scripts/set_custom_html_head.py
)

for required_file in "${REQUIRED_FILES[@]}"; do
  [[ -f "${SCRIPT_DIR}/${required_file}" ]] || fail "Missing release file: ${required_file}"
done

DEPLOY_STAGE="$(mktemp -d -t pg2-curation-deploy.XXXXXXXX)"
EXTENSION_STAGE="${DEPLOY_STAGE}/extension"
CLI_STAGE="${DEPLOY_STAGE}/cli"
CUSTOM_ASSETS_STAGE="${DEPLOY_STAGE}/custom_assets"
SSH_CONTROL_PATH="${DEPLOY_STAGE}/ssh-control"

mkdir -p \
  "${EXTENSION_STAGE}/src/db" \
  "${EXTENSION_STAGE}/src/pigallery" \
  "${EXTENSION_STAGE}/src/security" \
  "${CLI_STAGE}" \
  "${CUSTOM_ASSETS_STAGE}"

install -m 0644 package.json package-lock.json server.js config.js "${EXTENSION_STAGE}/"
install -m 0644 src/domain.js "${EXTENSION_STAGE}/src/"
install -m 0644 src/db/database.js src/db/repository.js "${EXTENSION_STAGE}/src/db/"
install -m 0644 src/pigallery/adapter.js "${EXTENSION_STAGE}/src/pigallery/"
install -m 0644 src/security/fingerprint.js src/security/paths.js "${EXTENSION_STAGE}/src/security/"

install -m 0755 cli/pg2-curation-delete cli/pg2-curation-review "${CLI_STAGE}/"
install -m 0755 cli/pg2_curation_delete.py cli/pg2_curation_review.py "${CLI_STAGE}/"
install -m 0644 cli/README.md cli/.env.example "${CLI_STAGE}/"
if [[ -f cli/.env ]]; then
  install -m 0600 cli/.env "${CLI_STAGE}/.env.deploy"
fi
install -m 0644 \
  custom_assets/pg2-curation-script.js \
  "${CUSTOM_ASSETS_STAGE}/${DEPLOY_BROWSER_ASSET_NAME}"

CUSTOM_SCRIPT_CACHE_TAG="$(node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const contents = fs.readFileSync("custom_assets/pg2-curation-script.js");
  process.stdout.write(crypto.createHash("sha256").update(contents).digest("hex").slice(0, 12));
')"
[[ "${CUSTOM_SCRIPT_CACHE_TAG}" =~ ^[a-f0-9]{12}$ ]] || \
  fail "Could not calculate the custom script cache tag"

echo "Connecting to ${DEPLOY_REMOTE} (one password prompt for this deployment)..."
ssh \
  -o ControlMaster=yes \
  -o ControlPersist=60 \
  -o "ControlPath=${SSH_CONTROL_PATH}" \
  -Nf \
  "${DEPLOY_REMOTE}"
SSH_MASTER_ACTIVE=1

echo "Preparing remote directories on ${DEPLOY_REMOTE}..."
ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" \
  "mkdir -p ${DEPLOY_EXTENSION_DIR} ${DEPLOY_CLI_DIR} ${DEPLOY_CUSTOM_ASSETS_DIR} && command -v python3 >/dev/null"

echo "Checking ${DEPLOY_CONTAINER} state..."
REMOTE_CONTAINER_STATE="$(ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
  if ! docker inspect ${DEPLOY_CONTAINER} >/dev/null 2>&1; then
    echo missing
  elif test \"\$(docker inspect -f '{{.State.Running}}' ${DEPLOY_CONTAINER})\" = true; then
    echo running
  else
    echo stopped
  fi
")"

case "${REMOTE_CONTAINER_STATE}" in
  running)
    echo "Stopping ${DEPLOY_CONTAINER} for a consistent extension update..."
    ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" \
      "docker stop --time 30 ${DEPLOY_CONTAINER}" >/dev/null
    ;;
  stopped)
    echo "${DEPLOY_CONTAINER} is already stopped; continuing with deployment."
    ;;
  missing)
    echo "${DEPLOY_CONTAINER} does not exist; creating it with Docker Compose without starting it..."
    echo "Copying custom browser assets needed by Compose file bind mounts..."
    scp -o "ControlPath=${SSH_CONTROL_PATH}" -r \
      "${CUSTOM_ASSETS_STAGE}/." "${DEPLOY_REMOTE}:${DEPLOY_CUSTOM_ASSETS_DIR}/"
    ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
      set -e
      cd ${DEPLOY_COMPOSE_DIR}
      if docker compose version >/dev/null 2>&1; then
        docker compose create ${DEPLOY_COMPOSE_SERVICE}
      elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose create ${DEPLOY_COMPOSE_SERVICE}
      else
        echo 'ERROR: Docker Compose is not installed on the server' >&2
        exit 1
      fi
      docker inspect ${DEPLOY_CONTAINER} >/dev/null
    " >/dev/null
    ;;
  *)
    fail "Unexpected remote container state: ${REMOTE_CONTAINER_STATE}"
    ;;
esac
REMOTE_START_REQUIRED=1

echo "Copying extension production files..."
scp -o "ControlPath=${SSH_CONTROL_PATH}" -r \
  "${EXTENSION_STAGE}/." "${DEPLOY_REMOTE}:${DEPLOY_EXTENSION_DIR}/"

echo "Copying host CLI files (the existing .env is preserved)..."
scp -o "ControlPath=${SSH_CONTROL_PATH}" -r \
  "${CLI_STAGE}/." "${DEPLOY_REMOTE}:${DEPLOY_CLI_DIR}/"
ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
  if test -f ${DEPLOY_CLI_DIR}/.env.deploy; then
    if test -f ${DEPLOY_CLI_DIR}/.env; then
      rm -f ${DEPLOY_CLI_DIR}/.env.deploy
      echo 'Preserved existing CLI .env.'
    else
      mv ${DEPLOY_CLI_DIR}/.env.deploy ${DEPLOY_CLI_DIR}/.env
      chmod 600 ${DEPLOY_CLI_DIR}/.env
      echo 'Installed initial CLI .env from the local cli/.env.'
    fi
  fi
"

echo "Copying custom browser assets..."
scp -o "ControlPath=${SSH_CONTROL_PATH}" -r \
  "${CUSTOM_ASSETS_STAGE}/." "${DEPLOY_REMOTE}:${DEPLOY_CUSTOM_ASSETS_DIR}/"

echo "Setting Server.customHTMLHead in PiGallery2 config..."
ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" \
  python3 - --config "${DEPLOY_CONFIG_FILE}" --cache-tag "${CUSTOM_SCRIPT_CACHE_TAG}" \
  --asset-url "${DEPLOY_BROWSER_ASSET_NAME}" \
  < "${SCRIPT_DIR}/scripts/set_custom_html_head.py"

if [[ "${DEPLOY_INSTALL_DEPENDENCIES}" == "true" ]]; then
  echo "Installing locked production dependencies with the PiGallery2 container image..."
  ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
    set -e
    container_image=\"\$(docker inspect -f '{{.Config.Image}}' ${DEPLOY_CONTAINER})\"
    test -n \"\${container_image}\"
    docker run --rm --user 0:0 \
      --volume ${DEPLOY_EXTENSION_DIR}:${DEPLOY_CONTAINER_EXTENSION_DIR} \
      --entrypoint npm \
      \"\${container_image}\" \
      ci --omit=dev --prefix ${DEPLOY_CONTAINER_EXTENSION_DIR}
  "
else
  echo "Skipping dependency installation; the remote extension must already have compatible node_modules."
fi

if [[ "${DEPLOY_RECREATE_CONTAINER}" == "true" ]]; then
  echo "Recreating ${DEPLOY_CONTAINER} with Docker Compose so configured mounts are current..."
  recreate_remote_container
else
  echo "Starting ${DEPLOY_CONTAINER} without recreation..."
  start_remote_container
fi
REMOTE_START_REQUIRED=0

ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" \
  "test \"\$(docker inspect -f '{{.State.Running}}' ${DEPLOY_CONTAINER})\" = true"

echo "Validating required Docker mounts..."
ssh -o "ControlPath=${SSH_CONTROL_PATH}" "${DEPLOY_REMOTE}" "
  set -e
  test \"\$(docker inspect -f '{{range .Mounts}}{{if eq .Destination \"${DEPLOY_CONTAINER_CURATION_DIR}\"}}{{.RW}}{{end}}{{end}}' ${DEPLOY_CONTAINER})\" = true || {
    echo 'ERROR: writable curation mount is missing at ${DEPLOY_CONTAINER_CURATION_DIR}' >&2
    exit 1
  }
  test \"\$(docker inspect -f '{{range .Mounts}}{{if eq .Destination \"${DEPLOY_CONTAINER_IMAGE_DIR}\"}}{{.RW}}{{end}}{{end}}' ${DEPLOY_CONTAINER})\" = false || {
    echo 'ERROR: read-only photo-library mount is missing at ${DEPLOY_CONTAINER_IMAGE_DIR}' >&2
    exit 1
  }
  test \"\$(docker inspect -f '{{range .Mounts}}{{if eq .Destination \"${DEPLOY_CONTAINER_ASSET_PATH}\"}}{{.RW}}{{end}}{{end}}' ${DEPLOY_CONTAINER})\" = false || {
    echo 'ERROR: read-only browser asset mount is missing at ${DEPLOY_CONTAINER_ASSET_PATH}' >&2
    exit 1
  }
  docker exec ${DEPLOY_CONTAINER} test -f ${DEPLOY_CONTAINER_ASSET_PATH}
"

echo
echo "Deployment complete."
echo "Extension: ${DEPLOY_REMOTE}:${DEPLOY_EXTENSION_DIR}"
echo "CLI:       ${DEPLOY_REMOTE}:${DEPLOY_CLI_DIR}"
echo "Assets:    ${DEPLOY_REMOTE}:${DEPLOY_CUSTOM_ASSETS_DIR}"
echo "HTML head: ${DEPLOY_REMOTE}:${DEPLOY_CONFIG_FILE} (Server.customHTMLHead)"
echo
echo "The remote curation.sqlite, CLI .env, and unrelated custom assets were not modified."
if [[ "${DEPLOY_INSTALL_DEPENDENCIES}" == "true" ]]; then
  echo "Extension runtime dependencies were installed from package-lock.json."
else
  echo "Extension node_modules was preserved because dependency installation is disabled."
fi
echo "Check startup with:"
echo "  ssh ${DEPLOY_REMOTE} 'docker logs --since 2m ${DEPLOY_CONTAINER} 2>&1 | grep -Ei \"extension|curation|error\"'"
