# PiGallery2 Curation — Deletion Review

A community extension and host-side toolset that adds a moderated photo-deletion workflow to PiGallery2 while keeping PiGallery2's photo-library mount read-only.

Family members can request deletion, administrators can approve or decline, and a separate defensive Python command performs approved deletions on the Docker host. PiGallery2 itself never needs permission to alter the canonical photo library.

Current release: **0.3.0**
Tested target: **PiGallery2 3.5.x**, extension kit **3.5.2**, Node.js **22**
License: **MIT**

> This project can permanently delete photographs when its host command is run with `--execute`. Maintain tested backups, review the dry-run output, and keep the PiGallery2 image mount read-only.

## Contents

- [How it works](#how-it-works)
- [Functionality](#functionality)
- [Permission and state rules](#permission-and-state-rules)
- [Security model](#security-model)
- [Prerequisites and Docker mounts](#prerequisites-and-docker-mounts)
- [Installation A: server installer](#installation-a-server-installer)
- [Installation B: development deployment script](#installation-b-development-deployment-script)
- [Installation C: manual](#installation-c-manual)
- [Extension settings](#extension-settings)
- [Reviewing and executing deletions](#reviewing-and-executing-deletions)
- [Upgrades and backups](#upgrades-and-backups)
- [Troubleshooting](#troubleshooting)
- [Known PiGallery2 UI limitations](#known-pigallery2-ui-limitations)
- [Development](#development)

## How it works

The project has four cooperating components:

1. **PiGallery2 server extension** — authenticates actions, applies request and moderation rules, stores workflow records, and projects state into PiGallery2's cached metadata.
2. **Curation SQLite database** — stores deletion items, individual requester rows, moderation cycles, fingerprints, outcomes, and an append-only audit event history. It is separate from PiGallery2's disposable media index.
3. **Host-side Python commands** — provide a read-only review report and a deliberately defensive deletion executor. Only the executor needs write access to the real photo library.
4. **Frontend adaptation** — `custom-scripts.js` hides or shows actions according to authenticated permissions and per-photo curation tags. A small `Server.customHTMLHead` loader injects the asset without modifying PiGallery2's base image.

The normal flow is:

```text
User requests deletion
        ↓
SQLite item becomes PENDING; PiGallery cache receives curation tags
        ↓
Administrator approves or declines
        ↓
APPROVED items are reviewed with the host CLI
        ↓
Host CLI validates path + fingerprint and, only with --execute, deletes
        ↓
Item becomes EXECUTED or ERROR; PiGallery2 is reindexed
```

The photo library remains mounted at `/app/data/images:ro` throughout this workflow.

## Functionality

### Requests and moderation

- Authenticated, permitted users receive a **Request deletion** action with confirmation and an optional reason.
- The request allowlist supports every authenticated user, all administrators, named users, or combinations of these categories.
- Multiple users can request deletion of the same photo without creating duplicate deletion items.
- Duplicate clicks by the same user are idempotent.
- A requester can withdraw only their own active request, even if an administrator later removes their general request permission.
- If other active requesters remain, the item stays active for them. If the last requester withdraws, the item leaves the pending or approved queue.
- Only authenticated PiGallery2 administrators can approve or decline.
- Administrative decline works for pending, approved, and failed items. Executed items are immutable.
- Declined photos may be requested again in a new moderation cycle; history from earlier cycles remains available.

### SQLite workflow data

The extension creates and migrates its own SQLite database. It uses WAL mode, foreign keys, a busy timeout, and transactional state changes.

The database contains:

- one `deletion_items` row per normalized media path;
- one or more `deletion_requests` rows containing authenticated user-ID/name snapshots, timestamps, reasons, cycles, and withdrawal timestamps;
- `curation_events` audit rows for requests, withdrawals, approval, decline, cancellation, execution, and failure;
- approved file size, modification time, SHA-256 digest, and algorithm.

Back up this database. It contains human workflow and audit information and is not equivalent to PiGallery2's regenerable media index.

### PiGallery2 integration

The extension restores synthetic keywords whenever PiGallery2 loads photo metadata:

- `pg-curation:delete-pending`
- `pg-curation:delete-approved`
- `pg-curation:delete-error`
- `pg-curation:requested-by:<username>`

These keywords exist only in PiGallery2's cache. They are not written into the photo or XMP sidecar.

The extension creates locked saved searches:

- **🗑 Deletion requests**
- **✓ Approved for deletion**
- **⚠ Deletion errors**

### Frontend adaptation

PiGallery2 3.5.x exposes extension buttons but does not consistently apply `minUserRole`. The supplied browser script corrects presentation without changing the PiGallery2 image:

- it requests the current user's permission decisions from an authenticated extension endpoint;
- it never contains or downloads the full request allowlist;
- it fails closed, keeping all curation actions hidden if permission loading fails;
- it uses cached curation tags to determine the current photo state;
- it exposes **Cancel my deletion request** only when the current username has a corresponding requester tag.

The JavaScript is presentation only. Every action is independently authorized and validated on the server.

### Host commands

`pg2-curation-review` reports pending and approved items by default, including requester names, timestamps, reasons, approval, cancellation, errors, and state.

`pg2-curation-delete` is dry-run by default. It rejects:

- absolute or traversing database paths;
- paths escaping the configured photo root;
- final media symlinks;
- missing or unsupported fingerprints;
- file size, modification-time, or SHA-256 changes;
- unsafe XMP sidecar paths or changed file identity;
- items that leave the approved queue before deletion.

Immediately before unlinking, the command takes a SQLite write lock and rechecks the item. A cancellation that commits first prevents deletion; a deletion that already claimed the item completes before a later cancellation can change its state.

## Permission and state rules

The `Deletion request access` extension setting accepts a case-insensitive comma-separated list:

| Setting | Meaning |
| --- | --- |
| `*` | Every authenticated PiGallery2 user |
| `admin` | Every user with the Administrator role or higher |
| `family-user` | The individual PiGallery2 username `family-user` |
| `admin, family-user` | All administrators plus one named user |
| `user:admin` | A literal non-administrator whose username is `admin` |

Button visibility is state-dependent and always subject to authenticated permissions:

| Photo state | Permitted requester | Administrator | Other authenticated user |
| --- | --- | --- | --- |
| No active request | Request | Request only if allowlisted | Nothing |
| Pending, requested by current user | Cancel own request | Approve, Decline, and own Cancel when applicable | Own Cancel only |
| Pending, requested by someone else | Nothing | Approve and Decline | Nothing |
| Approved, requested by current user | Cancel own request | Decline and own Cancel when applicable | Own Cancel only |
| Approved, requested by someone else | Nothing | Decline | Nothing |
| Error | Own Cancel when applicable | Own Cancel when applicable | Nothing |

Server rules are stricter than display rules: a user ID must own an active request row to withdraw it, and administrator role is checked on every moderation request.

## Security model

- PiGallery2 receives **read-only** access to the photo library.
- The extension derives the actor from PiGallery2's authenticated session and the media from PiGallery2's authorized media callback.
- Client-submitted usernames, requester tags, and arbitrary filesystem paths never grant authority.
- Request permission, own-request ownership, and administrator moderation are enforced server-side.
- SQLite mutations are transactional and requester withdrawals are scoped to the current moderation cycle.
- Approved fingerprints are recalculated when an administrator approves.
- The deletion command operates on normalized relative paths beneath one configured host root and uses filesystem APIs rather than interpolated shell commands.
- Browser code can be removed or manipulated without bypassing the backend checks.
- Free-text reasons remain in the curation database and are not projected into XMP.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and deployment-boundary guidance.

## Prerequisites and Docker mounts

Before either installation method, the server needs:

- an existing PiGallery2 3.5.x Docker Compose deployment;
- a persistent PiGallery2 config directory;
- a persistent PiGallery2 database directory;
- a separate persistent curation directory visible to both the container and host;
- the photo library mounted read-only in PiGallery2 and writable only to the trusted host account that will execute deletions;
- a file bind mount exposing `custom-scripts.js` in every enabled PiGallery2 locale.

A parameterized example is provided in [examples/docker-compose.yml](examples/docker-compose.yml) with [examples/docker-compose.env.example](examples/docker-compose.env.example). The relevant mounts are:

```yaml
services:
  pigallery2:
    volumes:
      - "${PG2_CONFIG_DIR}:/app/data/config"
      - "${PG2_DATABASE_DIR}:/app/data/db"
      - "${PG2_CURATION_DIR}:/app/data/curation"
      - "${PG2_PHOTO_LIBRARY}:/app/data/images:ro"
      - "${PG2_CUSTOM_ASSETS_DIR}/custom-scripts.js:/app/dist/en/custom-scripts.js:ro"
```

For each additional enabled locale, add another mount using the same source and a different destination, for example `/app/dist/fr/custom-scripts.js`.

Docker Compose and this repository can use several separate `.env` contexts:

- the server's Compose `.env` supplies paths used by `docker-compose.yml`;
- the repository root `.env` supplies server-local installation paths and settings to `install.sh`;
- `.env.deploy` supplies SSH and deployment paths to `deploy-to-server.sh` on a development workstation;
- `cli/.env` supplies the database and photo-root paths used by the host Python commands.

None of these real `.env` files should be committed.

## Installation A: server installer

This is the recommended installation and upgrade method. The repository lives on the PiGallery2 Docker host, and `install.sh` updates it directly without SSH or SCP.

### 1. Prepare PiGallery2 Compose mounts

Add the curation and locale-specific custom-script mounts described above. The installer does not rewrite `docker-compose.yml`; deployment-specific Compose changes remain under the server administrator's control.

The host must have Git, Python 3, Docker, and Docker Compose. Node.js and npm are not required on the host because runtime dependencies are installed using the PiGallery2 Docker image.

### 2. Clone and configure

Run on the PiGallery2 server:

```bash
git clone <repository-url> /opt/pigallery2-curation
cd /opt/pigallery2-curation
cp .env.example .env
chmod 600 .env
```

Edit `.env`. Its paths must describe the existing server deployment. In particular:

| Variable | Purpose |
| --- | --- |
| `PG2_INSTALL_ROOT` | Base host directory for the existing PiGallery2 deployment |
| `PG2_CONTAINER` | Actual Docker container name |
| `PG2_COMPOSE_DIR` | Directory containing the existing Compose file |
| `PG2_COMPOSE_SERVICE` | Compose service name, which may differ from the container name |
| `PG2_EXTENSION_DIR` | Host destination for extension production files |
| `PG2_CLI_DIR` | Host destination for review/deletion tools |
| `PG2_CUSTOM_ASSETS_DIR` | Host directory bound into PiGallery2 locale assets |
| `PG2_CONFIG_FILE` | Existing host PiGallery2 `config.json` |
| `PG2_EXTENSION_DATABASE_PATH` | SQLite path seen inside the PiGallery2 container |
| `PG2_EXTENSION_REQUESTER_ALLOWLIST` | `*`, `admin`, named users, or a combination |
| `PG2_CURATION_DB` | The same SQLite database as a path on the Docker host |
| `PG2_PHOTO_ROOT` | Writable canonical photo-library path on the Docker host |
| `PG2_SIDECAR_STYLE` | `none`, `appended`, or `stem` |

Only simple absolute paths containing letters, numbers, `.`, `_`, `-`, and `/` are accepted. The installer parses `.env` as data; it never executes the file as shell code.

### 3. Validate and install

```bash
./install.sh --check-config
./install.sh
```

The installer:

1. fast-forwards the Git checkout with `git pull --ff-only` and re-executes its updated version;
2. creates the required host directories and installs only runtime extension, CLI, and browser files;
3. creates `cli/.env` from the host paths in the root `.env`;
4. atomically configures the extension settings and `Server.customHTMLHead` while preserving unrelated PiGallery2 settings;
5. stops the configured container, or creates it from Compose when absent;
6. installs locked production dependencies using the PiGallery2 image and server architecture;
7. recreates the Compose service and validates its writable curation, read-only images, and read-only browser-asset mounts.

The curation database and photo library are never replaced by the installer. If installation fails after stopping an existing container, the cleanup handler attempts to start it again.

For later upgrades, keep the private `.env` in the checkout and run:

```bash
cd /opt/pigallery2-curation
./install.sh
```

Set `PG2_INSTALL_GIT_PULL=false` only when installing from a local archive or intentionally testing an already checked-out revision.
Automatic updates refuse tracked local source changes, so upgrades cannot silently combine a published release with hand-edited runtime files. The ignored private `.env` does not prevent an update.

## Installation B: development deployment script

The retained `deploy-to-server.sh` is appropriate during development, when the repository is built on a workstation and PiGallery2 runs on another Docker host.

### 1. Prepare PiGallery2 Compose mounts

Add the curation and locale-specific custom-script mounts described above. The deployment script copies the source asset before creating a not-yet-existing container, so file bind mounts work on a first deployment.

The script does not rewrite `docker-compose.yml`; deployment-specific Compose changes remain under the server administrator's control.

### 2. Install local build requirements

On the workstation:

```bash
git clone <repository-url>
cd <repository-directory>
npm ci
```

Requirements are Node.js 22, npm, Python 3, SSH, and SCP.

### 3. Configure deployment

```bash
cp .env.deploy.example .env.deploy
```

Edit `.env.deploy` and set every value for the target server. The important variables are:

| Variable | Purpose |
| --- | --- |
| `PG2_DEPLOY_REMOTE` | SSH destination such as `deploy-user@photos.example.net` or an SSH config alias |
| `PG2_DEPLOY_BASE` | Base host directory for this PiGallery2 deployment |
| `PG2_DEPLOY_CONTAINER` | Actual Docker container name |
| `PG2_DEPLOY_COMPOSE_DIR` | Host directory containing the Compose file |
| `PG2_DEPLOY_COMPOSE_SERVICE` | Compose service name, which may differ from the container name |
| `PG2_DEPLOY_EXTENSION_DIR` | Host destination for extension production files |
| `PG2_DEPLOY_CLI_DIR` | Host destination for Python review/deletion tools |
| `PG2_DEPLOY_CUSTOM_ASSETS_DIR` | Host directory bound into PiGallery2 locale assets |
| `PG2_DEPLOY_CONFIG_FILE` | Host PiGallery2 `config.json` |
| `PG2_DEPLOY_CONTAINER_EXTENSION_DIR` | Extension path inside the container |
| `PG2_DEPLOY_CONTAINER_CURATION_DIR` | Destination of the writable curation bind mount |
| `PG2_DEPLOY_CONTAINER_IMAGE_DIR` | Destination of the required read-only image mount |
| `PG2_DEPLOY_CONTAINER_ASSET_PATH` | Read-only browser asset destination for the primary locale |
| `PG2_DEPLOY_RECREATE_CONTAINER` | `true` to apply current Compose mounts with `--force-recreate` |
| `PG2_DEPLOY_INSTALL_DEPENDENCIES` | `true` to install locked production packages using the PiGallery2 image |

Only simple absolute paths containing letters, numbers, `.`, `_`, `-`, and `/` are accepted. Use an SSH config alias for non-default ports, identity files, jump hosts, or other SSH-specific settings.

### 4. Configure the host CLI

```bash
cp cli/.env.example cli/.env
```

Edit it with paths as seen by the **Docker host**, not paths inside the container:

```dotenv
PG2_CURATION_DB=/path/on/host/curation/curation.sqlite
PG2_PHOTO_ROOT=/path/on/host/photo-library
PG2_SIDECAR_STYLE=none
```

On the first deployment, the script installs this file remotely with mode `0600`. On upgrades, an existing remote CLI `.env` is always preserved. If the local `cli/.env` does not exist, only `.env.example` is copied.

### 5. Deploy

Validate the resolved private configuration without contacting the server:

```bash
./deploy-to-server.sh --check-config
```

Then deploy:

```bash
./deploy-to-server.sh
```

The script:

1. builds and runs all tests locally;
2. stages only extension production files, CLI files, and the browser asset;
3. opens one shared SSH connection;
4. stops the configured container, or creates it without starting when absent;
5. copies the extension, CLI, and custom asset while preserving SQLite and existing CLI configuration;
6. atomically sets `Server.customHTMLHead` in PiGallery2's existing `config.json` with a content-derived cache tag;
7. optionally installs locked production dependencies using the PiGallery2 image and server architecture;
8. recreates the Compose service by default so new mounts take effect;
9. verifies that the container is running, curation is writable, images are read-only, and the primary-locale browser asset is mounted read-only.

If deployment fails after stopping the container, the cleanup handler attempts to start it again.

### 6. Configure and verify the extension

Open PiGallery2's extension settings and configure the values documented under [Extension settings](#extension-settings). Restart or reload the extension, then hard-refresh the browser.

Check the Docker logs for a line similar to:

```text
Curation database: /app/data/curation/curation.sqlite
```

## Installation C: manual

Manual installation is suitable when working directly on the Docker host or when deployment over SSH is undesirable.

### 1. Build and test a release checkout

```bash
git clone <repository-url>
cd <repository-directory>
npm ci
npm test
```

The build produces the checked-in JavaScript consumed by PiGallery2. Keep the compiled files from one release together; do not mix `server.js` or `config.js` with a different `src` bundle.

### 2. Stop PiGallery2 and create host directories

Set paths appropriate for the server in a private environment file or shell environment. The following names are illustrative:

```dotenv
PG2_EXTENSION_DIR=/path/on/host/config/extensions/request-deletions
PG2_CLI_DIR=/path/on/host/curation/cli
PG2_CUSTOM_ASSETS_DIR=/path/on/host/custom_assets
PG2_CONFIG_FILE=/path/on/host/config/config.json
PG2_CONTAINER_NAME=pigallery2
PG2_CONTAINER_EXTENSION_DIR=/app/data/config/extensions/request-deletions
```

Stop the container and create the three destination directories.

### 3. Copy extension production files

Copy only these files and directory structures into `PG2_EXTENSION_DIR`:

```text
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
```

The TypeScript sources, source maps, tests, documentation, and development dependencies are not required by the running extension.

### 4. Install extension runtime dependencies

Install with the PiGallery2 image so native modules match the container architecture. With the PiGallery2 container already created but stopped:

```bash
PG2_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PG2_CONTAINER_NAME")"
docker run --rm --user 0:0 \
  --volume "$PG2_EXTENSION_DIR:$PG2_CONTAINER_EXTENSION_DIR" \
  --entrypoint npm \
  "$PG2_IMAGE" \
  ci --omit=dev --prefix "$PG2_CONTAINER_EXTENSION_DIR"
```

### 5. Install the host commands

Copy these files into `PG2_CLI_DIR`:

```text
cli/pg2-curation-review
cli/pg2-curation-delete
cli/pg2_curation_review.py
cli/pg2_curation_delete.py
cli/.env.example
cli/README.md
```

Preserve executable mode on the four command/script files. Copy `.env.example` to `.env`, set the host database and photo-root paths, and restrict it to the administrative account:

```bash
chmod 600 "$PG2_CLI_DIR/.env"
```

### 6. Install the browser asset

Copy `custom_assets/custom-scripts.js` to:

```text
$PG2_CUSTOM_ASSETS_DIR/custom-scripts.js
```

Ensure the Compose file binds that file read-only into `/app/dist/<locale>/custom-scripts.js` for every PiGallery2 locale in use. Recreate the container after adding a new bind mount.

### 7. Configure extension settings and `Server.customHTMLHead`

Run the supplied atomic configuration helper while PiGallery2 is stopped:

```bash
python3 scripts/set_custom_html_head.py \
  --config "$PG2_CONFIG_FILE" \
  --asset "$PG2_CUSTOM_ASSETS_DIR/custom-scripts.js" \
  --extension-folder request-deletions \
  --database-path /app/data/curation/curation.sqlite \
  --requester-allowlist '*' \
  --reason-max-length 4000
```

The helper parses the existing JSON, preserves unrelated settings, calculates a cache tag from the asset, and updates the named extension plus `Server.customHTMLHead`. It is idempotent and writes through a temporary file before replacing the original.

The resulting setting loads `custom-scripts.js` relative to the current PiGallery2 locale without requiring a PiGallery2 source patch.

### 8. Start, configure, and verify

Start PiGallery2, enable/reload the extension if necessary, configure its settings, and hard-refresh the browser. Verify the curation database path in Docker logs and test the complete workflow with a disposable photo before using the executor on a real library.

## Extension settings

Open PiGallery2 settings and locate the deletion-review extension.

### Curation SQLite path

Recommended Docker value:

```text
/app/data/curation/curation.sqlite
```

This path corresponds to the dedicated `/app/data/curation` bind mount. An absolute path is used as-is; a relative path is resolved against PiGallery2's configured database directory.

Configure this before accepting real requests. If the setting is later moved, stop PiGallery2 and move the existing database deliberately rather than starting a second empty workflow database.

### Maximum reason length

Maximum characters accepted for a requester's optional explanation. Default: `4000`.

### Deletion request access

Use the syntax documented under [Permission and state rules](#permission-and-state-rules). Approval and decline remain administrator-only regardless of this value.

The frontend queries the extension for current-user decisions on page load. After changing access settings, reload the gallery; no JavaScript user list needs to be edited or redeployed.

## Reviewing and executing deletions

Run these commands on the host that can see both `curation.sqlite` and the real photo root.

### Review

From the deployed CLI directory:

```bash
./pg2-curation-review
```

The default `ACTIVE` view contains `PENDING` and `APPROVED` items. Other views are available:

```bash
./pg2-curation-review --state PENDING
./pg2-curation-review --state APPROVED
./pg2-curation-review --state DECLINED
./pg2-curation-review --state EXECUTED
./pg2-curation-review --state ERROR
./pg2-curation-review --state ALL
```

### Dry run

Omitting both mode flags is also a dry run:

```bash
./pg2-curation-delete --dry-run
```

Review every resolved path. Require `Fingerprint matches: YES` and `0 safety errors` before considering execution.

### Execute

```bash
./pg2-curation-delete --execute
```

The command processes every item still in `APPROVED` state. Successful records become `EXECUTED`; validation or filesystem failures become `ERROR`. Queue entries cancelled after the initial query are skipped safely.

The command does not require root specifically; it requires an account with write permission to the configured photo root and curation database. Use the least-privileged suitable account.

After execution, run PiGallery2 indexing so removed photos disappear and error projections are refreshed.

### XMP sidecars

Sidecar deletion is disabled unless explicitly configured:

| Value | Behavior |
| --- | --- |
| `none` | Delete only the approved media file |
| `appended` | Also delete `photo.jpg.xmp` |
| `stem` | Also delete `photo.xmp` |

Confirm the library's real naming convention first. `stem` can be unsafe when RAW and JPEG files share one sidecar.

Command-line flags override environment and `.env` values. See [cli/README.md](cli/README.md) or run either command with `--help`.

## Upgrades and backups

Before upgrading:

1. back up `curation.sqlite` together with its `-wal` and `-shm` files while PiGallery2 is stopped, or use SQLite's online backup mechanism;
2. keep a current backup of the photo library;
3. deploy the complete production bundle from one release;
4. reinstall locked runtime dependencies when `package-lock.json` changes;
5. restart PiGallery2 and check extension logs;
6. hard-refresh the browser so the new content-derived asset URL is loaded.

The server installer preserves the database and photo library. The development deployment script preserves the database, existing remote CLI `.env`, and unrelated custom assets.

## Troubleshooting

### Extension reports a missing or incompatible repository method

The extension bundle is mixed across releases. Replace `server.js`, `config.js`, and the complete compiled `src` tree together, reinstall production dependencies, and restart.

### Browser actions are all hidden

Check:

1. `Server.customHTMLHead` contains the loader generated by `set_custom_html_head.py`;
2. `custom-scripts.js` is mounted into the active locale directory;
3. the browser can request `/pgapi/extension/pigallery2-curation-deletion-review/client-permissions` while authenticated;
4. the extension is enabled and loaded;
5. a hard refresh has cleared the previous page.

The browser script intentionally fails closed when permission loading fails.

### CLI says the database does not exist

The CLI uses a **host path**, while the extension setting uses a **container path**. Both paths must point through the curation bind mount to the same file. Check `cli/.env`, the Compose mount, and the extension's logged database path.

### Requests exist as tags but not in SQLite

Do not delete or replace `curation.sqlite` independently of PiGallery2's cached metadata. The SQLite database is authoritative; tags are projections. Restore the correct database backup or deliberately clear/reindex stale cache state before accepting new requests.

### Browser asset returns 404 for one language

Add the same source-file bind mount for that locale, such as `/app/dist/fr/custom-scripts.js`, recreate the container, and hard-refresh.

## Known PiGallery2 UI limitations

- PiGallery2 3.5.x declares `minUserRole` on extension buttons but does not consistently use it while rendering. The custom script supplies correct presentation and the backend remains authoritative. The generic source-build patch in [patches/pigallery2-3.5.x-hide-role-buttons.patch](patches/pigallery2-3.5.x-hide-role-buttons.patch) implements native role filtering when building PiGallery2 itself.
- Extension actions appear on gallery thumbnails, not inside the native lightbox.
- Approve and Decline are state-dependent but are not restricted only to the saved-search pages because PiGallery2 does not expose a stable route/saved-search condition to extension buttons.
- Request reasons are available in SQLite and the host review report, not rendered on photo thumbnails.

These limitations affect presentation, not backend authorization.

## Repository layout

```text
server.ts / server.js          PiGallery2 extension entry point
config.ts / config.js          Extension settings template
src/                           Domain, SQLite, PiGallery adapter, path/fingerprint code
cli/                           Host review and deletion commands plus CLI .env example
custom_assets/                 Frontend permission/state adaptation
scripts/                       Safe config.json helper used for customHTMLHead
tests/                         Node and Python security/workflow tests
examples/                      Parameterized Docker Compose example
patches/                       Optional upstream PiGallery2 role-rendering patch
docs/                          Historical technical design specification
install.sh                     Recommended server-local installer and updater
deploy-to-server.sh            Configurable SSH development deployment script
.env.example                   Server installer configuration template
.env.deploy.example            Workstation development-deployment template
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm ci
npm test
```

Tests use only temporary SQLite databases and temporary photo roots. They never target a real library.

The original design document is retained at [docs/technical-specification.md](docs/technical-specification.md); this README describes the current implemented behavior.
