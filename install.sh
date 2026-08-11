#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ENV_FILE="${PG2_INSTALL_ENV_FILE:-${SCRIPT_DIR}/.env}"
CONTAINER_START_REQUIRED=0

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./install.sh [--check-config]

Install or update directly on the PiGallery2 Docker host using .env.
--check-config  Validate and print settings without Git, Docker, or file changes.
EOF
}

case "${1:-}" in
  "") INSTALL_MODE="install" ;;
  --check-config) INSTALL_MODE="check" ;;
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
  [[ -f "${env_file}" ]] || fail "Installer settings file does not exist: ${env_file} (copy .env.example to .env)"

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
    if [[ ! -v "${key}" ]]; then
      printf -v "${key}" '%s' "${value}"
    fi
  done < "${env_file}"
}

load_env_file "${INSTALL_ENV_FILE}"

INSTALL_ROOT="${PG2_INSTALL_ROOT:-}"
CONTAINER="${PG2_CONTAINER:-}"
COMPOSE_DIR="${PG2_COMPOSE_DIR:-${INSTALL_ROOT}}"
COMPOSE_SERVICE="${PG2_COMPOSE_SERVICE:-${CONTAINER}}"
EXTENSION_DIR="${PG2_EXTENSION_DIR:-${INSTALL_ROOT}/config/extensions/curation-requests}"
CLI_DIR="${PG2_CLI_DIR:-${INSTALL_ROOT}/curation/cli}"
CUSTOM_ASSETS_DIR="${PG2_CUSTOM_ASSETS_DIR:-${INSTALL_ROOT}/custom_assets}"
CONFIG_FILE="${PG2_CONFIG_FILE:-${INSTALL_ROOT}/config/config.json}"

CONTAINER_EXTENSION_DIR="${PG2_CONTAINER_EXTENSION_DIR:-/app/data/config/extensions/curation-requests}"
CONTAINER_CURATION_DIR="${PG2_CONTAINER_CURATION_DIR:-/app/data/curation}"
CONTAINER_IMAGE_DIR="${PG2_CONTAINER_IMAGE_DIR:-/app/data/images}"
CONTAINER_ASSET_PATH="${PG2_CONTAINER_ASSET_PATH:-/app/dist/en/pg2-curation-script.js}"

EXTENSION_FOLDER="${PG2_EXTENSION_FOLDER:-curation-requests}"
EXTENSION_DATABASE_PATH="${PG2_EXTENSION_DATABASE_PATH:-/app/data/curation/curation.sqlite}"
EXTENSION_REQUESTER_ALLOWLIST="${PG2_EXTENSION_REQUESTER_ALLOWLIST:-*}"
EXTENSION_COMMENT_MAX_LENGTH="${PG2_EXTENSION_COMMENT_MAX_LENGTH:-${PG2_EXTENSION_REASON_MAX_LENGTH:-4000}}"

CURATION_DB="${PG2_CURATION_DB:-}"
PHOTO_ROOT="${PG2_PHOTO_ROOT:-}"
SIDECAR_STYLE="${PG2_SIDECAR_STYLE:-none}"

INSTALL_GIT_PULL="${PG2_INSTALL_GIT_PULL:-true}"
INSTALL_DEPENDENCIES="${PG2_INSTALL_DEPENDENCIES:-true}"
RECREATE_CONTAINER="${PG2_RECREATE_CONTAINER:-true}"
OVERWRITE_CLI_ENV="${PG2_OVERWRITE_CLI_ENV:-false}"

[[ -n "${INSTALL_ROOT}" ]] || fail "PG2_INSTALL_ROOT is required in ${INSTALL_ENV_FILE}"
[[ -n "${CONTAINER}" ]] || fail "PG2_CONTAINER is required in ${INSTALL_ENV_FILE}"
[[ -n "${CURATION_DB}" ]] || fail "PG2_CURATION_DB is required in ${INSTALL_ENV_FILE}"
[[ -n "${PHOTO_ROOT}" ]] || fail "PG2_PHOTO_ROOT is required in ${INSTALL_ENV_FILE}"

for install_path in \
  "${INSTALL_ROOT}" \
  "${COMPOSE_DIR}" \
  "${EXTENSION_DIR}" \
  "${CLI_DIR}" \
  "${CUSTOM_ASSETS_DIR}" \
  "${CONFIG_FILE}" \
  "${CONTAINER_EXTENSION_DIR}" \
  "${CONTAINER_CURATION_DIR}" \
  "${CONTAINER_IMAGE_DIR}" \
  "${CONTAINER_ASSET_PATH}" \
  "${EXTENSION_DATABASE_PATH}" \
  "${CURATION_DB}" \
  "${PHOTO_ROOT}"; do
  [[ "${install_path}" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "Unsafe absolute installation path: ${install_path}"
  [[ "${install_path}" != "/" ]] || fail "Installation paths must not target the filesystem root"
  [[ "${install_path}" != *"//"* ]] || fail "Unsafe absolute installation path: ${install_path}"
  [[ ! "${install_path}" =~ (^|/)\.\.?(/|$) ]] || fail "Unsafe absolute installation path: ${install_path}"
done

[[ "${CONTAINER}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "Unsafe container name: ${CONTAINER}"
[[ "${COMPOSE_SERVICE}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "Unsafe Compose service name: ${COMPOSE_SERVICE}"
[[ "${EXTENSION_FOLDER}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "Unsafe extension folder: ${EXTENSION_FOLDER}"
[[ "${EXTENSION_COMMENT_MAX_LENGTH}" =~ ^[1-9][0-9]*$ ]] || fail "PG2_EXTENSION_COMMENT_MAX_LENGTH must be positive"
[[ "${SIDECAR_STYLE}" == "none" || "${SIDECAR_STYLE}" == "appended" || "${SIDECAR_STYLE}" == "stem" ]] || \
  fail "PG2_SIDECAR_STYLE must be none, appended, or stem"
for boolean_value in "${INSTALL_GIT_PULL}" "${INSTALL_DEPENDENCIES}" "${RECREATE_CONTAINER}" "${OVERWRITE_CLI_ENV}"; do
  [[ "${boolean_value}" == "true" || "${boolean_value}" == "false" ]] || fail "Installer boolean settings must be true or false"
done
BROWSER_ASSET_NAME="$(basename -- "${CONTAINER_ASSET_PATH}")"
[[ "${BROWSER_ASSET_NAME}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "Unsafe browser asset filename: ${BROWSER_ASSET_NAME}"

if [[ "${INSTALL_MODE}" == "check" ]]; then
  echo "Server installation configuration is valid."
  echo "Environment:           ${INSTALL_ENV_FILE}"
  echo "Source checkout:       ${SCRIPT_DIR}"
  echo "Install root:          ${INSTALL_ROOT}"
  echo "Compose directory:     ${COMPOSE_DIR}"
  echo "Compose service:       ${COMPOSE_SERVICE}"
  echo "Container:             ${CONTAINER}"
  echo "Extension (host):      ${EXTENSION_DIR}"
  echo "Extension (container): ${CONTAINER_EXTENSION_DIR}"
  echo "CLI directory:         ${CLI_DIR}"
  echo "Curation DB (host):    ${CURATION_DB}"
  echo "Photo root (host):     ${PHOTO_ROOT}"
  echo "Extension DB:          ${EXTENSION_DATABASE_PATH}"
  echo "Requester allowlist:   ${EXTENSION_REQUESTER_ALLOWLIST}"
  echo "Git pull:              ${INSTALL_GIT_PULL}"
  echo "Install dependencies:  ${INSTALL_DEPENDENCIES}"
  echo "Recreate container:    ${RECREATE_CONTAINER}"
  echo "Browser asset name:    ${BROWSER_ASSET_NAME}"
  echo "Overwrite CLI .env:    ${OVERWRITE_CLI_ENV}"
  exit 0
fi

cleanup() {
  local exit_code=$?
  if [[ "${CONTAINER_START_REQUIRED}" == "1" ]]; then
    echo "Installation did not finish; attempting to start ${CONTAINER}..." >&2
    docker start "${CONTAINER}" >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

command -v docker >/dev/null || fail "Docker is required"
command -v python3 >/dev/null || fail "Python 3 is required"

if [[ "${INSTALL_GIT_PULL}" == "true" && "${PG2_INSTALL_REEXECUTED:-false}" != "true" ]]; then
  command -v git >/dev/null || fail "Git is required when PG2_INSTALL_GIT_PULL=true"
  git -C "${SCRIPT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1 || \
    fail "${SCRIPT_DIR} is not a Git checkout; set PG2_INSTALL_GIT_PULL=false or clone the repository"
  git -C "${SCRIPT_DIR}" diff --quiet && git -C "${SCRIPT_DIR}" diff --cached --quiet || \
    fail "Tracked source files have local changes; commit or restore them before installing"
  echo "Updating source checkout with git pull --ff-only..."
  git -C "${SCRIPT_DIR}" pull --ff-only
  export PG2_INSTALL_REEXECUTED=true
  exec "${SCRIPT_DIR}/install.sh"
fi

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
[[ -f "${CONFIG_FILE}" ]] || fail "PiGallery2 config does not exist: ${CONFIG_FILE}"

compose_create() {
  (
    cd "${COMPOSE_DIR}"
    if docker compose version >/dev/null 2>&1; then
      docker compose create "${COMPOSE_SERVICE}"
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose create "${COMPOSE_SERVICE}"
    else
      fail "Docker Compose is not installed"
    fi
  )
}

compose_recreate() {
  (
    cd "${COMPOSE_DIR}"
    if docker compose version >/dev/null 2>&1; then
      docker compose up -d --force-recreate "${COMPOSE_SERVICE}"
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose up -d --force-recreate "${COMPOSE_SERVICE}"
    else
      fail "Docker Compose is not installed"
    fi
  )
}

mount_rw() {
  local destination="$1"
  docker inspect -f "{{range .Mounts}}{{if eq .Destination \"${destination}\"}}{{.RW}}{{end}}{{end}}" "${CONTAINER}"
}

validate_configured_mounts() {
  [[ "$(mount_rw "${CONTAINER_CURATION_DIR}")" == "true" ]] || \
    fail "Compose must provide a writable curation mount at ${CONTAINER_CURATION_DIR}; install.sh does not edit Compose files"
  [[ "$(mount_rw "${CONTAINER_IMAGE_DIR}")" == "false" ]] || \
    fail "Compose must provide the photo library read-only at ${CONTAINER_IMAGE_DIR}; install.sh does not edit Compose files"
  [[ "$(mount_rw "${CONTAINER_ASSET_PATH}")" == "false" ]] || \
    fail "Compose must provide a read-only browser asset mount at ${CONTAINER_ASSET_PATH}; install.sh does not edit Compose files"
}

mkdir -p "${EXTENSION_DIR}" "${CLI_DIR}" "${CUSTOM_ASSETS_DIR}" "$(dirname -- "${CURATION_DB}")"

# The source file must exist before Compose creates a file bind mount.
install -m 0644 \
  "${SCRIPT_DIR}/custom_assets/pg2-curation-script.js" \
  "${CUSTOM_ASSETS_DIR}/${BROWSER_ASSET_NAME}"

if ! docker inspect "${CONTAINER}" >/dev/null 2>&1; then
  echo "Creating ${CONTAINER} with Docker Compose without starting it..."
  compose_create >/dev/null
  docker inspect "${CONTAINER}" >/dev/null 2>&1 || fail "Compose did not create configured container ${CONTAINER}"
elif [[ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER}")" == "true" ]]; then
  echo "Stopping ${CONTAINER} for a consistent installation..."
  docker stop --time 30 "${CONTAINER}" >/dev/null
else
  echo "${CONTAINER} is already stopped."
fi
CONTAINER_START_REQUIRED=1

echo "Validating required mounts before changing PiGallery2 configuration..."
validate_configured_mounts

echo "Installing extension production files..."
mkdir -p "${EXTENSION_DIR}/src/db" "${EXTENSION_DIR}/src/pigallery" "${EXTENSION_DIR}/src/security"
install -m 0644 \
  "${SCRIPT_DIR}/package.json" \
  "${SCRIPT_DIR}/package-lock.json" \
  "${SCRIPT_DIR}/server.js" \
  "${SCRIPT_DIR}/config.js" \
  "${EXTENSION_DIR}/"
install -m 0644 "${SCRIPT_DIR}/src/domain.js" "${EXTENSION_DIR}/src/"
install -m 0644 "${SCRIPT_DIR}/src/db/database.js" "${SCRIPT_DIR}/src/db/repository.js" "${EXTENSION_DIR}/src/db/"
install -m 0644 "${SCRIPT_DIR}/src/pigallery/adapter.js" "${EXTENSION_DIR}/src/pigallery/"
install -m 0644 "${SCRIPT_DIR}/src/security/fingerprint.js" "${SCRIPT_DIR}/src/security/paths.js" "${EXTENSION_DIR}/src/security/"

echo "Installing host review and deletion commands..."
install -m 0755 \
  "${SCRIPT_DIR}/cli/pg2-curation-delete" \
  "${SCRIPT_DIR}/cli/pg2-curation-review" \
  "${SCRIPT_DIR}/cli/pg2_curation_delete.py" \
  "${SCRIPT_DIR}/cli/pg2_curation_review.py" \
  "${CLI_DIR}/"
install -m 0644 "${SCRIPT_DIR}/cli/README.md" "${SCRIPT_DIR}/cli/.env.example" "${CLI_DIR}/"

if [[ ! -f "${CLI_DIR}/.env" || "${OVERWRITE_CLI_ENV}" == "true" ]]; then
  cli_env_temp="$(mktemp "${CLI_DIR}/.env.XXXXXXXX")"
  chmod 0600 "${cli_env_temp}"
  printf '%s\n' \
    "PG2_CURATION_DB=${CURATION_DB}" \
    "PG2_PHOTO_ROOT=${PHOTO_ROOT}" \
    "PG2_SIDECAR_STYLE=${SIDECAR_STYLE}" \
    > "${cli_env_temp}"
  mv -f "${cli_env_temp}" "${CLI_DIR}/.env"
else
  echo "Preserving existing CLI settings: ${CLI_DIR}/.env"
fi

echo "Configuring PiGallery2 extension settings and browser loader..."
python3 "${SCRIPT_DIR}/scripts/set_custom_html_head.py" \
  --config "${CONFIG_FILE}" \
  --asset "${CUSTOM_ASSETS_DIR}/${BROWSER_ASSET_NAME}" \
  --asset-url "${BROWSER_ASSET_NAME}" \
  --extension-folder "${EXTENSION_FOLDER}" \
  --database-path "${EXTENSION_DATABASE_PATH}" \
  --requester-allowlist "${EXTENSION_REQUESTER_ALLOWLIST}" \
  --comment-max-length "${EXTENSION_COMMENT_MAX_LENGTH}"

if [[ "${INSTALL_DEPENDENCIES}" == "true" ]]; then
  echo "Installing locked production dependencies with the PiGallery2 image..."
  container_image="$(docker inspect -f '{{.Config.Image}}' "${CONTAINER}")"
  [[ -n "${container_image}" ]] || fail "Could not determine the PiGallery2 container image"
  docker run --rm --user 0:0 \
    --volume "${EXTENSION_DIR}:${CONTAINER_EXTENSION_DIR}" \
    --entrypoint npm \
    "${container_image}" \
    ci --omit=dev --prefix "${CONTAINER_EXTENSION_DIR}"
else
  echo "Skipping dependency installation; compatible extension node_modules must already exist."
fi

if [[ "${RECREATE_CONTAINER}" == "true" ]]; then
  echo "Recreating ${CONTAINER} so current Compose mounts take effect..."
  compose_recreate
else
  echo "Starting ${CONTAINER} without recreation..."
  docker start "${CONTAINER}" >/dev/null
fi

[[ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER}")" == "true" ]] || fail "${CONTAINER} is not running"

validate_configured_mounts
docker exec "${CONTAINER}" test -f "${CONTAINER_ASSET_PATH}" || fail "Browser asset is not visible inside the container"

CONTAINER_START_REQUIRED=0

echo
echo "Installation complete."
echo "Extension: ${EXTENSION_DIR}"
echo "Curation DB: ${CURATION_DB}"
echo "CLI: ${CLI_DIR}"
echo "Browser asset: ${CUSTOM_ASSETS_DIR}/${BROWSER_ASSET_NAME}"
echo "Config backup: ${CONFIG_FILE}.pg2-curation.bak (created once, before the first change)"
echo
echo "Inspect startup with: docker logs --since 2m ${CONTAINER}"
