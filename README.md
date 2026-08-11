# PiGallery2 Curation Requests

A community extension and host-side toolset for moderated photo curation in PiGallery2. Family members can report deletion and metadata problems, administrators can review them, and a separate defensive host command performs only approved deletions.

PiGallery2 keeps read-only access to the canonical photo library.

Current release: **1.0.0**
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
- row-level cancellation of one owned request from the request-details dialog;
- administrator-only deletion approval and decline;
- administrator-only approval, completion, and dismissal of metadata requests;
- in-gallery comment/details display for administrators and request owners;
- flat saved searches for open work, every metadata category, and deletion states;
- a per-user **Curation mode** toggle in PiGallery2's Tools menu;
- a **My curation requests** Tools-menu shortcut using an exact native PiGallery keyword search;
- a read-only host report covering metadata and deletion work;
- a dry-run-by-default, fingerprint-verifying deletion executor;
- automatic migration of existing deletion-only and earlier curation databases.

## Architecture

The project has four cooperating components:

1. **PiGallery2 extension** — authenticates users, validates requests, applies state transitions, and updates synthetic cached keywords.
2. **Curation SQLite database** — stores requests, comments, moderation outcomes, fingerprints, and audit events independently of PiGallery2's regenerable media index.
3. **Host commands** — report all curation work and execute only approved deletions.
4. **Frontend adaptation** — applies state and permission visibility, inserts Curation mode, and displays authorized request details without modifying PiGallery2's base code.

### Components: required and optional

| Component | Required? | Purpose | What happens without it |
| --- | --- | --- | --- |
| Extension JavaScript and its production dependencies | Yes | Authenticates requests, enforces permissions, stores state, projects keywords, and creates saved searches | No curation workflow |
| Persistent `curation.sqlite` mount | Yes | Authoritative requests, moderation state, comments, fingerprints, and audit history | State is lost with the container or the extension cannot start safely |
| `pg2-curation-script.js` plus the `customHTMLHead` loader | Required for the supported UI | Permission-aware visibility, Curation mode, request details/comments, batch controls, My requests, popup presentation, and backdrop dismissal | Backend checks still protect routes, but the frontend is incomplete and PiGallery2 may render role-inappropriate native controls |
| `pg2-curation-review` | Optional | Trusted-host text report of metadata and deletion queues | Review remains possible in the gallery |
| `pg2-curation-delete` | Optional unless approved deletion should be executed | Dry-run verification and deliberate deletion of approved files | Approved deletion rows remain queued; nothing is deleted |
| SSH deployment script | Optional development tool | Copies a local checkout to a remote Docker host | Use the server-local installer or manual installation |
| PiGallery2 source patch in `patches/` | Optional | Native upstream-style role filtering | The standard extension and frontend adaptation remain fully server-secured |

The extension and curation database are the authoritative core. The browser script never grants authority; it is nevertheless part of the supported installation because it provides the complete, comprehensible user interface.

```text
Request curation
      │
      ├── Metadata correction ── OPEN ──┬── APPROVED ── RESOLVED after the edit
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
- only administrators can approve, complete, or dismiss metadata requests;
- only administrators can approve or decline deletion;
- comments are returned only to administrators or their owning requester;
- client-supplied usernames, tags, paths, and roles never grant permission.

The browser JavaScript is presentation logic. Removing or changing it cannot bypass these checks.

## Request state and button visibility

All curation buttons are hidden while Curation mode is disabled. When enabled:

- authorized requesters see **Request curation**, except on photos for which that same user has an active deletion request;
- once deletion is approved, the whole photo is locked against every new curation request—including requests from administrators—until the photo-level deletion is declined or its final requester cancels it;
- an owner with active requests sees a separate **Cancel my requests** panel at the top of the request-details dialog;
- administrators receive an **All requests on this photo** panel beneath it; ordinary users never receive this panel;
- that administrator panel shows blue **Approve all metadata requests** while any request is pending; after all are approved it becomes the visually distinct green **Mark all metadata requests done** action;
- the administrator panel shows **Decline all metadata requests** while metadata work remains active, except after deletion has been approved;
- the same panel shows red **Approve all** and **Decline all** deletion controls according to the photo-level deletion state;
- administrators see deletion Approve only when deletion is pending;
- administrators see deletion Decline while deletion is pending, approved, or in error;
- a top-right request-details badge appears for administrators and for owners of requests on that photo;
- administrators can approve or decline one pending metadata request, then mark approved work done after making the correction; the existing bulk controls remain available.

Cancelling withdraws all active requests made by that user for that photo. It never affects requests made by another account.

For non-administrators, the details dialog offers **Cancel** for each request owned by the authenticated user. Metadata cancellation withdraws that pending or approved active row. Deletion cancellation works while the photo-level deletion state is `PENDING`, `APPROVED`, or `ERROR`; if other deletion requesters remain, their workflow continues, and cancelling the final deletion request removes the photo from the active deletion queue. Administrators do not receive the redundant owner-cancellation action because they already have moderation controls.

The batch workflow mirrors the granular workflow. All batch controls live at the top of the request-details dialog, above the clearly labelled individual request rows; the corresponding native photo-overlay batch icons are hidden. **Approve all metadata requests** accepts every still-pending row but keeps it active. When no pending rows remain, the blue approval control is replaced by a green **Mark all metadata requests done** control. Completion closes all approved rows as `RESOLVED`; **Decline all metadata requests** closes every pending or approved row as `DISMISSED`. Deletion state remains independent.

Deletion is an exclusive request choice for each requester. Selecting it clears and disables the metadata categories in the popup, and the server ignores metadata flags in any request that also contains deletion. A user who owns an active deletion request cannot add metadata requests for that photo, even by bypassing the frontend; other users remain free to report metadata problems. Therefore metadata and deletion moderation pairs may coexist for administrators when different users have submitted the two kinds of request; colored outlines distinguish them.

Granular metadata **Approve** accepts exactly that request as outstanding manual work. It stays active and visible as `APPROVED`; after making the change in DigiKam, **Mark done** closes it as `RESOLVED`. **Decline** closes either a pending or approved request as `DISMISSED`. Each transition is bound to the authenticated administrator, opaque photo token, PiGallery media path, request ID, and current active state in one SQLite transaction. Deletion rows also expose the existing red approval/decline operations in the details dialog. Because deletion is a file-level workflow, either deletion operation applies to the photo-level deletion item for every requester, and approval still calculates a fresh fingerprint. Once deletion is `APPROVED`, metadata moderation controls are hidden for that photo.

## Curation mode

The frontend script inserts a **Curation mode** switch inside PiGallery2's lazily rendered **Tools** submenu, immediately before **Fix navbar**. If that control is unavailable, **Auto update gallery** is used as the fallback position.

Directly beneath it, **My curation requests** opens PiGallery's native search with an exact match for the authenticated user's active synthetic requester keyword. It creates no saved album and therefore adds no per-user entries to the shared Albums page.

This is a live personal view, not a new database or private album. It shows only photos whose active projection names the currently authenticated user. Completed, declined, withdrawn, and executed work no longer appears there because it is no longer active.

- It defaults to disabled for a user who has not selected a preference.
- Its value is stored in browser `localStorage`, keyed by PiGallery2 user ID.
- It controls only action-button and request-details-badge visibility.
- It is not a permission or security boundary.
- If PiGallery2 changes the menu DOM and injection fails, curation actions remain hidden rather than becoming broadly visible.

## Comments in the gallery

Synthetic cached keywords include an opaque 32-character item token, not the comment. Clicking the top-right details badge asks an authenticated extension endpoint for details. Administrators receive controls for approving, completing, or dismissing individual active metadata rows; ordinary users see their own rows and can cancel them individually.

Administrators receive all active requests for that item. Ordinary users receive only requests stored under their authenticated user ID. The dialog renders all values as text, preventing request comments from being interpreted as HTML.

## Synthetic keywords and saved searches

The extension projects internal state into PiGallery2's cached metadata, for example:

```text
pg-curation:open
pg-curation:metadata-pending
pg-curation:metadata-approved
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
- `✎ Curation · Pending metadata`
- `✓ Curation · Approved metadata`
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

Existing schema-version 1 and 2 databases are upgraded automatically. Their deletion queue, metadata requests, and audit history are preserved. Back up `curation.sqlite`, `curation.sqlite-wal`, and `curation.sqlite-shm` before an upgrade while PiGallery2 is stopped, or use SQLite's online backup mechanism.

## Docker prerequisites

The server needs an existing PiGallery2 Docker Compose deployment with:

- persistent PiGallery2 config and database directories;
- a dedicated persistent curation directory;
- the photo library mounted read-only in PiGallery2;
- the photo library writable only to the trusted host account running the executor;
- `pg2-curation-script.js` mounted read-only into every enabled PiGallery2 locale.

See [examples/docker-compose.yml](examples/docker-compose.yml) and [examples/docker-compose.env.example](examples/docker-compose.env.example).

```yaml
services:
  pigallery2:
    volumes:
      - "${PG2_CONFIG_DIR}:/app/data/config"
      - "${PG2_DATABASE_DIR}:/app/data/db"
      - "${PG2_CURATION_DIR}:/app/data/curation"
      - "${PG2_PHOTO_LIBRARY}:/app/data/images:ro"
      - "${PG2_CUSTOM_ASSETS_DIR}/pg2-curation-script.js:/app/dist/en/pg2-curation-script.js:ro"
```

Add another asset mount for each additional locale, changing only `/app/dist/<locale>/pg2-curation-script.js`.

These mounts must already be present in the deployment's Compose file before running `install.sh`. The installer deliberately does **not** edit `compose.yml`, `compose.yaml`, `docker-compose.yml`, or `docker-compose.yaml`; Compose layouts, service names, YAML anchors, reverse proxies, and locale sets vary too much to rewrite safely. It validates the resulting container mounts before changing PiGallery2 configuration.

## Installation A: directly on the server

This is the recommended public installation and upgrade method. It uses Git locally on the Docker host and requires no SSH or SCP deployment stage.

### 1. Prepare the existing Compose deployment

Add the three mounts shown under [Docker prerequisites](#docker-prerequisites) to the actual PiGallery2 service, including one browser-asset mount per enabled locale. Create the host curation and custom-assets directories. Do not start with paths copied blindly from the example: use the host paths, service name, container name, image path, and locales from the existing installation.

The PiGallery2 container must see:

- the curation directory writable at the configured `PG2_CONTAINER_CURATION_DIR`;
- the photo library read-only at `PG2_CONTAINER_IMAGE_DIR`;
- the browser file read-only at `PG2_CONTAINER_ASSET_PATH`.

### 2. Clone and configure

```bash
git clone https://github.com/v-marinkov/pigallery2-curation-requests.git /opt/pigallery2-curation-requests
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
| `PG2_CONTAINER_EXTENSION_DIR` | Extension directory as seen inside the container |
| `PG2_CONTAINER_CURATION_DIR` | Writable curation mount destination inside the container |
| `PG2_CONTAINER_IMAGE_DIR` | Read-only image mount destination inside the container |
| `PG2_CONTAINER_ASSET_PATH` | Browser asset destination inside one active locale |
| `PG2_EXTENSION_FOLDER` | PiGallery2 extension folder and configuration key |
| `PG2_EXTENSION_DATABASE_PATH` | SQLite path inside the container |
| `PG2_EXTENSION_REQUESTER_ALLOWLIST` | Request access expression |
| `PG2_EXTENSION_COMMENT_MAX_LENGTH` | Maximum comment length |
| `PG2_CURATION_DB` | The same SQLite file as a host path |
| `PG2_PHOTO_ROOT` | Canonical photo-library host path |
| `PG2_SIDECAR_STYLE` | `none`, `appended`, or `stem` |
| `PG2_OVERWRITE_CLI_ENV` | Overwrite an existing CLI `.env`; default `false` |
| `PG2_INSTALL_GIT_PULL` | Fast-forward the source checkout before installation |
| `PG2_INSTALL_DEPENDENCIES` | Rebuild extension production dependencies from the lockfile |
| `PG2_RECREATE_CONTAINER` | Recreate the service from existing Compose rather than merely starting it |

The file is parsed as data and is never sourced as shell code. Installation paths reject shell characters, traversal components, doubled separators, and filesystem-root targets.

### 3. Validate and install

```bash
./install.sh --check-config
./install.sh
```

The installer:

1. fast-forwards the clean Git checkout with `git pull --ff-only`;
2. copies only production extension, CLI, and browser files;
3. creates the host CLI `.env` with mode `0600`, but preserves an existing one unless `PG2_OVERWRITE_CLI_ENV=true`;
4. atomically configures extension settings and merges a marked loader block into `Server.customHTMLHead`;
5. stops or Compose-creates the configured container;
6. installs locked production dependencies using the PiGallery2 image;
7. recreates the Compose service;
8. validates writable curation, read-only images, and the read-only browser asset.

It never replaces the curation database or photo library and never edits a Compose file. If installation fails after stopping a container, its cleanup handler attempts to start it again.

### Exactly what `install.sh` changes

Review this list before running it on an established server:

| Target | Installer behavior |
| --- | --- |
| Git checkout | With `PG2_INSTALL_GIT_PULL=true`, requires a clean tracked tree and runs `git pull --ff-only` |
| Extension directory | Overwrites the named production files from this release; does not copy TypeScript or tests |
| Extension `node_modules` | With dependency installation enabled, `npm ci --omit=dev` makes it match `package-lock.json` |
| CLI directory | Overwrites the two launchers, two Python programs, README, and `.env.example` |
| CLI `.env` | Creates it if absent; otherwise preserves it by default |
| Browser asset | Overwrites only the configured asset filename, normally `pg2-curation-script.js` |
| PiGallery2 `config.json` | Creates `config.json.pg2-curation.bak` once, then atomically updates this extension's `enabled`, `path`, and `configs` keys and replaces/appends only the marked curation loader inside `Server.customHTMLHead` |
| Existing `customHTMLHead` code | Preserved. A loader generated by an older release is migrated instead of duplicated |
| Compose YAML | Never read-modified-written; the existing service may be stopped and recreated with the existing Compose definition |
| Curation SQLite | Never copied or cleared; schema migrations run when the extension starts |
| Photo library | Never touched by installation; only an explicit later `pg2-curation-delete --execute` can remove approved files |

Atomic JSON replacement can reformat `config.json` using two-space indentation. The one-time backup is therefore important even though unrelated JSON values and custom head code are preserved.

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

The script builds and tests locally, opens one multiplexed SSH connection, stops or creates the container, copies only production files, installs dependencies through the target image, merges the marked `customHTMLHead` loader, recreates the service, and validates its mounts. Like `install.sh`, it does not edit remote Compose YAML; required mounts must already exist there.

An existing remote CLI `.env`, curation database, unrelated custom assets, and unrelated `customHTMLHead` code are preserved. Named extension production files and the configured curation browser asset are updated.

## Installation C: manual

### 1. Build and test

```bash
git clone <repository-url>
cd pigallery2-curation-requests
npm ci
npm test
```

### 2. Copy extension production files

Stop the PiGallery2 container before replacing runtime files and keep it stopped through configuration. Ensure the curation, read-only image, and per-locale browser-asset mounts have already been added to the real Compose service.

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

Copy `custom_assets/pg2-curation-script.js` to the source path used by every locale bind mount.

### 5. Configure PiGallery2 atomically

While PiGallery2 is stopped:

```bash
python3 scripts/set_custom_html_head.py \
  --config "$PG2_CONFIG_FILE" \
  --asset "$PG2_CUSTOM_ASSETS_DIR/pg2-curation-script.js" \
  --asset-url pg2-curation-script.js \
  --extension-folder curation-requests \
  --database-path /app/data/curation/curation.sqlite \
  --requester-allowlist '*' \
  --comment-max-length 4000
```

The helper preserves unrelated JSON settings and existing custom head code, creates a one-time `config.json.pg2-curation.bak`, writes through a temporary file, retains file ownership/mode where permitted, and uses a content-derived browser cache tag.

If configuration is performed manually, enable the extension under `Extensions.extensions` using the actual extension folder:

```json
{
  "Extensions": {
    "extensions": {
      "curation-requests": {
        "enabled": true,
        "path": "curation-requests",
        "configs": {
          "databasePath": "/app/data/curation/curation.sqlite",
          "reasonMaxLength": 4000,
          "requesterAllowlist": "*"
        }
      }
    }
  }
}
```

Do not replace other keys in `Extensions` or `Server`. PiGallery2 places `Server.customHTMLHead` inside an existing `<script>` element, so append JavaScript—not another `<script>` tag—to any code already in that setting. Replace `CACHE_TAG` whenever the asset changes:

```javascript
/* pg2-curation-loader:start */
(() => {
  if (document.getElementById('pg2-curation-script-loader')) {
    return;
  }

  const script = document.createElement('script');
  script.id = 'pg2-curation-script-loader';
  script.src = new URL(
    'pg2-curation-script.js?v=CACHE_TAG',
    document.baseURI
  ).href;
  document.head.appendChild(script);
})();
/* pg2-curation-loader:end */
```

For an existing `customHTMLHead` value, retain it and place the marked block after it. The supplied helper performs exactly this merge and is safer than editing JSON by hand.

### 6. Start and verify

Recreate the configured service from its existing Compose file, inspect startup logs, and hard-refresh the browser:

```bash
cd "$PG2_COMPOSE_DIR"
docker compose up -d --force-recreate "$PG2_COMPOSE_SERVICE"
docker logs --since 2m "$PG2_CONTAINER"
```

Confirm that `/app/data/curation` is writable, `/app/data/images` is read-only, and the browser asset is a read-only file mount at every enabled locale path. Then enable Curation mode from PiGallery2's Tools menu.

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

- pending and approved metadata correction requests;
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

Successful execution removes the media file (and the configured XMP sidecar, if selected) and retains the curation row as `EXECUTED` audit history. It does not write directly to PiGallery2's separate media-index database. Run PiGallery2's indexing job afterward; when the affected directory is indexed, PiGallery2 removes media database rows for files that are no longer present.

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

Database migration from schema versions 1 or 2 to the current schema is automatic. Existing deletion states, metadata requests, requesters, comments/reasons, fingerprints, approvals, and audit events remain in their original tables.

An existing private deployment may retain its old physical extension folder name if PiGallery2's extension config points to it consistently. New installations use `curation-requests`.

The canonical browser asset is now `pg2-curation-script.js`. An existing Compose deployment that still mounts `/app/dist/<locale>/custom-scripts.js` can be upgraded without an immediate YAML change: keep that legacy path explicitly in `PG2_CONTAINER_ASSET_PATH` (or `PG2_DEPLOY_CONTAINER_ASSET_PATH`). The installer copies the canonical source under the configured basename and generates a matching loader. New installations should use the canonical filename.

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

### A locale returns 404 for `pg2-curation-script.js`

Add the same source file as a read-only bind mount under that locale's `/app/dist/<locale>/` directory and recreate the container.

## Known PiGallery2 UI limitations

- Saved searches cannot be nested.
- PiGallery2 3.5.x does not consistently honor `minUserRole` when rendering extension buttons; the frontend script corrects presentation and the backend remains authoritative.
- Inserting Curation mode depends on the current Tools submenu controls (`fix-switch`, with `autopoll-interval-select` as a fallback).
- Batch metadata actions operate on all active metadata requests for one photo; granular controls remain available per row in the request-details dialog.
- The frontend adaptation is tied to PiGallery2 3.5.x DOM and compact-search conventions; it fails closed if permission synchronization fails.

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
