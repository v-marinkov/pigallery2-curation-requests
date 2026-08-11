# PiGallery2 Curation Requests

A community extension and host-side toolset for moderated photo curation in PiGallery2. Family members can report deletion and metadata problems, administrators can review them, and a separate defensive host command performs only approved deletions.

PiGallery2 keeps read-only access to the canonical photo library.

Current release: **0.4.0**
Tested target: **PiGallery2 3.5.x**, extension kit **3.5.2**, Node.js **22**
License: **MIT**

> `pg2-curation-delete --execute` can permanently delete photographs. Maintain tested backups, inspect its dry-run output, and keep PiGallery2's image mount read-only.

## What it provides

One **Request curation** pencil action lets an authorized user select one or more categories. Metadata corrections are grouped first, followed by the separate destructive deletion choice:

1. Wrong or missing faces
2. Wrong or missing tags
3. Wrong or missing location
4. Wrong date or time
5. Wrong or missing title/caption
6. Duplicate photo
7. Other
8. Request deletion
9. Comment (optional)

The optional comment is stored in SQLite. It is never written into a photo, XMP sidecar, or PiGallery keyword.

Other functionality includes:

- authenticated requester allowlists supporting `*`, `admin`, and named users;
- multiple requesters and multiple correction categories on the same photo;
- requester cancellation restricted to the authenticated user's own active requests;
- administrator-only deletion approval and decline;
- administrator-only resolution and dismissal of metadata requests;
- in-gallery comment/details display for administrators and request owners;
- flat saved searches for open work, every metadata category, and deletion states;
- a per-user **Curation mode** toggle in PiGallery2's Tools menu;
- a read-only host report covering metadata and deletion work;
- a dry-run-by-default, fingerprint-verifying deletion executor;
- automatic migration of existing version-1 deletion databases.

## Architecture

The project has four cooperating components:

1. **PiGallery2 extension** — authenticates users, validates requests, applies state transitions, and updates synthetic cached keywords.
2. **Curation SQLite database** — stores requests, comments, moderation outcomes, fingerprints, and audit events independently of PiGallery2's regenerable media index.
3. **Host commands** — report all curation work and execute only approved deletions.
4. **Frontend adaptation** — applies state and permission visibility, inserts Curation mode, and displays authorized request details without modifying PiGallery2's base code.

```text
Request curation
      │
      ├── Metadata correction ── OPEN ──┬── RESOLVED
      │                                ├── DISMISSED
      │                                └── WITHDRAWN by its owner
      │
      └── Deletion ── PENDING ──┬── APPROVED ── host executor ── EXECUTED
                                ├── DECLINED
                                ├── ERROR
                                └── cancelled when its final requester withdraws
```

Deletion remains a distinct security-sensitive subsystem. Metadata requests cannot enter the deletion executor.

## Permission rules

The `Curation request access` setting is a case-insensitive comma-separated list:

| Setting | Meaning |
| --- | --- |
| `*` | Every authenticated PiGallery2 user |
| `admin` | Every administrator |
| `family-user` | One named user |
| `admin, family-user` | All administrators plus one named user |
| `user:admin` | A literal non-administrator whose username is `admin` |

Server-side rules are authoritative:

- only allowlisted authenticated users can create requests;
- a user can withdraw only requests whose stored user ID matches their authenticated ID;
- only administrators can resolve or dismiss metadata requests;
- only administrators can approve or decline deletion;
- comments are returned only to administrators or their owning requester;
- client-supplied usernames, tags, paths, and roles never grant permission.

The browser JavaScript is presentation logic. Removing or changing it cannot bypass these checks.

## Request state and button visibility

All curation buttons are hidden while Curation mode is disabled. When enabled:

- authorized requesters see **Request curation**, except on photos for which that same user has an active deletion request;
- an owner with active requests sees **Cancel my curation requests**;
- administrators see metadata Resolve/Dismiss whenever metadata requests are open, except after deletion has been approved;
- administrators see deletion Approve only when deletion is pending;
- administrators see deletion Decline while deletion is pending, approved, or in error;
- a top-right request-details badge appears for administrators and for owners of requests on that photo;
- administrators can approve or decline one open metadata request from that details dialog, while the existing bulk controls remain available.

Cancelling withdraws all active requests made by that user for that photo. It never affects requests made by another account.

Resolving or dismissing metadata currently closes every open non-deletion request on that photo in one administrator action. Deletion state remains independent.

Deletion is an exclusive request choice for each requester. Selecting it clears and disables the metadata categories in the popup, and the server ignores metadata flags in any request that also contains deletion. A user who owns an active deletion request cannot add metadata requests for that photo, even by bypassing the frontend; other users remain free to report metadata problems. Therefore metadata and deletion moderation pairs may coexist for administrators when different users have submitted the two kinds of request; colored outlines distinguish them.

Granular metadata **Approve** closes exactly that request as `RESOLVED`; granular **Decline** closes it as `DISMISSED`. Each action is bound to the authenticated administrator, opaque photo token, PiGallery media path, request ID, and current `OPEN` state in one SQLite transaction. Deletion requests remain file-level decisions and use the separate red controls. Once deletion is `APPROVED`, metadata moderation controls are hidden for that photo.

## Curation mode

The frontend script inserts a **Curation mode** switch inside PiGallery2's lazily rendered **Tools** submenu, immediately before **Fix navbar**. If that control is unavailable, **Auto update gallery** is used as the fallback position.

- It defaults to disabled for a user who has not selected a preference.
- Its value is stored in browser `localStorage`, keyed by PiGallery2 user ID.
- It controls only action-button and request-details-badge visibility.
- It is not a permission or security boundary.
- If PiGallery2 changes the menu DOM and injection fails, curation actions remain hidden rather than becoming broadly visible.

## Comments in the gallery

Synthetic cached keywords include an opaque 32-character item token, not the comment. Clicking the top-right `ⓘ` badge asks an authenticated extension endpoint for details. Administrators also receive controls for resolving or dismissing individual open metadata rows; ordinary users receive a read-only view of their own rows.

Administrators receive all active requests for that item. Ordinary users receive only requests stored under their authenticated user ID. The dialog renders all values as text, preventing request comments from being interpreted as HTML.

## Synthetic keywords and saved searches

The extension projects internal state into PiGallery2's cached metadata, for example:

```text
pg-curation:open
pg-curation:category:faces
pg-curation:category:tags
pg-curation:delete-pending
pg-curation:delete-approved
pg-curation:requested-by:family-user
pg-curation:delete-requested-by:family-user
pg-curation:item:0123456789abcdef0123456789abcdef
```

These keywords are never written into media or XMP files. SQLite is authoritative; the keywords are a disposable projection used for saved searches and frontend state.

The extension creates locked saved searches:

- `✎ Curation · All open`
- `✎ Curation · Faces`
- `✎ Curation · Tags`
- `✎ Curation · Location`
- `✎ Curation · Date and time`
- `✎ Curation · Title and caption`
- `✎ Curation · Duplicates`
- `✎ Curation · Other`
- `🗑 Deletion requests`
- `✓ Approved for deletion`
- `⚠ Deletion errors`

PiGallery2 3.5.x saved searches are flat and have no parent-album relationship. The consistent names provide visual grouping; genuine nested saved searches are not available through the current API.

## Database

SQLite uses WAL mode, foreign keys, a busy timeout, transactional state changes, and schema migrations.

Deletion tables remain compatible with the original workflow:

- `deletion_items`
- `deletion_requests`
- `curation_events`

General curation adds:

- `curation_media`, including the opaque browser lookup token;
- `metadata_requests`;
- `metadata_request_events`.

An existing version-1 database is upgraded automatically. Its deletion queue and audit history are preserved. Back up `curation.sqlite`, `curation.sqlite-wal`, and `curation.sqlite-shm` before an upgrade while PiGallery2 is stopped, or use SQLite's online backup mechanism.

## Docker prerequisites

The server needs an existing PiGallery2 Docker Compose deployment with:

- persistent PiGallery2 config and database directories;
- a dedicated persistent curation directory;
- the photo library mounted read-only in PiGallery2;
- the photo library writable only to the trusted host account running the executor;
- `custom-scripts.js` mounted read-only into every enabled PiGallery2 locale.

See [examples/docker-compose.yml](examples/docker-compose.yml) and [examples/docker-compose.env.example](examples/docker-compose.env.example).

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

Add another asset mount for each additional locale, changing only `/app/dist/<locale>/custom-scripts.js`.

## Installation A: directly on the server

This is the recommended public installation and upgrade method. It uses Git locally on the Docker host and requires no SSH or SCP deployment stage.

### 1. Clone and configure

```bash
git clone <repository-url> /opt/pigallery2-curation-requests
cd /opt/pigallery2-curation-requests
cp .env.example .env
chmod 600 .env
```

Edit `.env` for the existing Docker deployment:

| Variable | Purpose |
| --- | --- |
| `PG2_INSTALL_ROOT` | Existing PiGallery2 deployment root |
| `PG2_CONTAINER` | Docker container name |
| `PG2_COMPOSE_DIR` | Directory containing the Compose file |
| `PG2_COMPOSE_SERVICE` | Compose service name |
| `PG2_EXTENSION_DIR` | Host extension destination |
| `PG2_CLI_DIR` | Host review/deletion command destination |
| `PG2_CUSTOM_ASSETS_DIR` | Source directory for locale asset mounts |
| `PG2_CONFIG_FILE` | Existing PiGallery2 `config.json` |
| `PG2_EXTENSION_DATABASE_PATH` | SQLite path inside the container |
| `PG2_EXTENSION_REQUESTER_ALLOWLIST` | Request access expression |
| `PG2_EXTENSION_COMMENT_MAX_LENGTH` | Maximum comment length |
| `PG2_CURATION_DB` | The same SQLite file as a host path |
| `PG2_PHOTO_ROOT` | Canonical photo-library host path |
| `PG2_SIDECAR_STYLE` | `none`, `appended`, or `stem` |

The file is parsed as data and is never sourced as shell code. Installation paths reject shell characters, traversal components, doubled separators, and filesystem-root targets.

### 2. Validate and install

```bash
./install.sh --check-config
./install.sh
```

The installer:

1. fast-forwards the clean Git checkout with `git pull --ff-only`;
2. copies only production extension, CLI, and browser files;
3. generates the host CLI `.env` with mode `0600`;
4. atomically configures extension settings and `Server.customHTMLHead`;
5. stops or Compose-creates the configured container;
6. installs locked production dependencies using the PiGallery2 image;
7. recreates the Compose service;
8. validates writable curation, read-only images, and the read-only browser asset.

It never replaces the curation database or photo library. If installation fails after stopping a container, its cleanup handler attempts to start it again.

Later upgrades use the same command:

```bash
cd /opt/pigallery2-curation-requests
./install.sh
```

The installer refuses tracked local source changes so a published release cannot be silently mixed with hand-edited runtime files. The ignored private `.env` is preserved.

## Installation B: workstation development deployment

`deploy-to-server.sh` remains available for development when the source lives on one computer and PiGallery2 runs on another.

Requirements on the workstation are Node.js 22, npm, Python 3, SSH, and SCP.

```bash
npm ci
cp .env.deploy.example .env.deploy
cp cli/.env.example cli/.env
```

Configure `.env.deploy` with the SSH destination and remote host/container paths. Configure `cli/.env` with host paths to the remote curation database and photo root if it should be installed on the first deployment.

```bash
./deploy-to-server.sh --check-config
./deploy-to-server.sh
```

The script builds and tests locally, opens one multiplexed SSH connection, stops or creates the container, copies only production files, installs dependencies through the target image, updates `customHTMLHead`, recreates the service, and validates its mounts.

An existing remote CLI `.env`, curation database, and unrelated custom assets are preserved.

## Installation C: manual

### 1. Build and test

```bash
git clone <repository-url>
cd pigallery2-curation-requests
npm ci
npm test
```

### 2. Copy extension production files

Copy this exact bundle into the configured extension directory:

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

Do not mix JavaScript files from different releases.

### 3. Install runtime dependencies

Use the PiGallery2 image so native modules match its architecture:

```bash
PG2_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PG2_CONTAINER")"
docker run --rm --user 0:0 \
  --volume "$PG2_EXTENSION_DIR:$PG2_CONTAINER_EXTENSION_DIR" \
  --entrypoint npm \
  "$PG2_IMAGE" \
  ci --omit=dev --prefix "$PG2_CONTAINER_EXTENSION_DIR"
```

### 4. Install CLI and browser files

Copy these into the trusted host CLI directory:

```text
cli/pg2-curation-review
cli/pg2-curation-delete
cli/pg2_curation_review.py
cli/pg2_curation_delete.py
cli/.env.example
cli/README.md
```

Copy `custom_assets/custom-scripts.js` to the source path used by every locale bind mount.

### 5. Configure PiGallery2 atomically

While PiGallery2 is stopped:

```bash
python3 scripts/set_custom_html_head.py \
  --config "$PG2_CONFIG_FILE" \
  --asset "$PG2_CUSTOM_ASSETS_DIR/custom-scripts.js" \
  --extension-folder curation-requests \
  --database-path /app/data/curation/curation.sqlite \
  --requester-allowlist '*' \
  --comment-max-length 4000
```

The helper preserves unrelated JSON settings, writes through a temporary file, retains file ownership/mode where permitted, and uses a content-derived browser cache tag.

## Extension settings

### Curation SQLite path

Recommended container value:

```text
/app/data/curation/curation.sqlite
```

An absolute path is used directly. A relative path is resolved against PiGallery2's database folder.

### Maximum comment length

Maximum accepted length for requester and resolution comments. Default: `4000`.

The internal config key remains `reasonMaxLength` for migration compatibility with the deletion-only release.

### Curation request access

Use the allowlist syntax described under [Permission rules](#permission-rules). Reload the gallery after changing it; the frontend retrieves current-user decisions from the authenticated backend and contains no copied username list.

## Host review and deletion

The installer places both commands in the configured CLI directory. See [cli/README.md](cli/README.md) for the short reference.

### Review active work

```bash
./pg2-curation-review
```

The default `ACTIVE` report contains:

- open metadata correction requests;
- pending deletion requests;
- approved deletion work.

Other filters include:

```bash
./pg2-curation-review --state OPEN
./pg2-curation-review --state RESOLVED
./pg2-curation-review --state DISMISSED
./pg2-curation-review --state WITHDRAWN
./pg2-curation-review --state PENDING
./pg2-curation-review --state APPROVED
./pg2-curation-review --state ERROR
./pg2-curation-review --state EXECUTED
./pg2-curation-review --state ALL
```

### Dry-run approved deletion work

Dry-run is the default:

```bash
./pg2-curation-delete --dry-run
```

Review every resolved path. Require `Fingerprint matches: YES` and `0 safety errors`.

### Execute approved deletion work

```bash
./pg2-curation-delete --execute
```

The executor processes only rows in `deletion_items` whose state is still `APPROVED`. It verifies path containment, rejects final media symlinks, checks file size, modification time and SHA-256, locks SQLite, rechecks queue state, and only then unlinks.

Metadata requests are stored in a separate table and cannot be selected by this command.

After execution, run PiGallery2 indexing so removed photos disappear.

### XMP sidecars

| Setting | Behavior |
| --- | --- |
| `none` | Delete only the approved media file |
| `appended` | Also delete `photo.jpg.xmp` |
| `stem` | Also delete `photo.xmp` |

Confirm the library's naming convention. `stem` can be unsafe when RAW and JPEG files share one sidecar.

## Security properties

- PiGallery2 has read-only photo-library access.
- Media identity and filesystem paths come from PiGallery2's authorized media callback.
- Request creation, ownership, comment visibility, and moderation are checked server-side.
- Metadata categories are a fixed server-side enum.
- Free text is length-limited and rendered with `textContent` in the browser.
- Deletion approval recalculates a SHA-256 fingerprint.
- Execution rechecks approval under a SQLite write lock.
- Absolute, traversing, escaping, symlinked, missing, and changed files fail closed.
- A request cancelled before the executor claims it is skipped.
- Browser visibility and Curation mode never grant authority.

See [SECURITY.md](SECURITY.md).

## Upgrading from the deletion-only release

Before upgrading:

1. stop PiGallery2;
2. back up the SQLite database together with WAL/SHM files;
3. deploy `server.js`, `config.js`, and the complete compiled `src` tree from one release;
4. reinstall production dependencies;
5. deploy the updated browser script and cache-tagged loader;
6. start PiGallery2 and check logs;
7. hard-refresh the browser.

Database migration from schema version 1 to 2 is automatic. Existing deletion states, requesters, comments/reasons, fingerprints, approvals, and audit events remain in their original tables.

An existing private deployment may retain its old physical extension folder name if PiGallery2's extension config points to it consistently. New installations use `curation-requests`.

## Troubleshooting

### All buttons are hidden

Check:

1. Curation mode is enabled in the frame dropdown;
2. `Server.customHTMLHead` contains the generated loader;
3. the asset is mounted into the active locale;
4. `/client-permissions` succeeds while authenticated;
5. the extension is enabled;
6. a hard refresh loaded the new cache-tagged asset.

The frontend intentionally fails closed.

### Request-details badge shows no details

Ordinary users see only their own request rows. Administrators see every active request. Confirm that the session is authenticated and `/request-details/<token>` succeeds.

### CLI cannot find the database

The extension uses a container path while the CLI uses a host path. Both must resolve through the curation bind mount to the same file.

### Tags exist but SQLite has no request

SQLite is authoritative. Do not delete it independently of PiGallery2's cached metadata. Restore the correct backup or deliberately clear/reindex stale projections.

### A locale returns 404 for `custom-scripts.js`

Add the same source file as a read-only bind mount under that locale's `/app/dist/<locale>/` directory and recreate the container.

## Known PiGallery2 UI limitations

- Saved searches cannot be nested.
- PiGallery2 3.5.x does not consistently honor `minUserRole` when rendering extension buttons; the frontend script corrects presentation and the backend remains authoritative.
- Inserting Curation mode depends on the current Tools submenu controls (`fix-switch`, with `autopoll-interval-select` as a fallback).
- Metadata Resolve/Dismiss currently acts on all open non-deletion requests for one photo.
- Extension actions appear on gallery thumbnails rather than inside the native lightbox in the tested PiGallery2 version.

The optional source-build patch under `patches/` implements native role filtering, but it is not required and the standard installation modifies no PiGallery2 base code.

## Repository layout

```text
server.ts / server.js          Extension entry point and secured routes
config.ts / config.js          Extension settings template
src/db/                        SQLite schema, migrations, and repositories
src/domain.*                   States, categories, and synthetic projection
src/pigallery/                 PiGallery integration and saved searches
src/security/                  Path and fingerprint protection
custom_assets/                 Curation mode, permissions, state, comments UI
cli/                           Host review and deletion commands
scripts/                       Atomic PiGallery config helper
tests/                         Workflow, migration, installer, and executor tests
examples/                      Parameterized Docker Compose example
patches/                       Optional upstream role-filtering patch
docs/                          Historical deletion-workflow specification
install.sh                     Recommended server-local installer/updater
deploy-to-server.sh            SSH/SCP development deployment tool
.env.example                   Server installer template
.env.deploy.example            Development deployment template
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm ci
npm test
```

TypeScript compilation writes the production JavaScript and source maps beside source files. Commit source and generated output together.

The original deletion-only design is retained at [docs/technical-specification.md](docs/technical-specification.md) as historical design context.
