# PiGallery2 Curation / Deletion-Review Extension — Technical Specification

> Historical design specification. The repository README documents the current implemented behavior and is authoritative for installation and operation.

## 1. Objective

Develop a PiGallery2 extension that allows authenticated family members to **request that individual photos be deleted**, while keeping PiGallery2 itself read-only against the canonical photo library.

The extension must provide a moderated workflow:

1. A logged-in user browses PiGallery2.
2. The user clicks **Request deletion** on an individual image.
3. A confirmation popup appears.
4. The user may enter an optional reason.
5. The extension records:
   - which image was requested for deletion;
   - which authenticated PiGallery2 user requested it;
   - when they requested it;
   - their reason.
6. The image is added to a native PiGallery2 logical/saved-search collection such as **Deletion requests**.
7. An administrator can browse this collection using PiGallery2's ordinary gallery/lightbox UI.
8. The administrator can:
   - approve the deletion request;
   - decline the deletion request.
9. Approval still **must not delete the file**.
10. Approved items appear in another PiGallery2 logical/saved-search collection such as **Approved for deletion**.
11. Actual deletion is performed separately by an administrator using a trusted host-side/local command with filesystem access.
12. After successful deletion, PiGallery2 is reindexed or otherwise allowed to detect that the source files disappeared.

PiGallery2 should therefore remain a **review and curation UI**, not the filesystem authority.

---

# 2. Existing Environment / Architectural Constraints

The canonical family photo archive has these properties:

- Existing filesystem folder structure is authoritative.
- Nested folders represent the archive hierarchy, e.g.:

      Family Library/
      ├── 2024/
      │   └── Christmas/
      ├── 2025/
      │   └── Summer Holiday/
      └── 2026/

- DigiKam is used to manage:
  - metadata;
  - tags;
  - face regions;
  - XMP sidecars.
- PiGallery2 indexes and displays the archive.
- PiGallery2's database should be regarded as an **index/cache**, not as authoritative permanent storage.
- The image filesystem should preferably remain mounted read-only inside PiGallery2.
- No extension feature should directly modify or delete the canonical images or XMP sidecars.
- There must remain only one PiGallery2 indexing of each image.
- The extension may add its own persistent application data, but must not create a second media index.

The expected deployment should continue to allow something conceptually like:

    /photos -> PiGallery2 images directory, read-only

while a separate host-side process has write access to `/photos`.

---

# 3. Core Design Principle

Use **two layers of state**:

## A. Authoritative curation state

Store deletion requests and approval state in a persistent extension-owned SQLite database, independent of PiGallery2's disposable/index database.

Example:

    /var/lib/pigallery2-curation/curation.sqlite

or an equivalent location under the persistent PiGallery2 config/data volume.

This database is authoritative for:

- deletion requests;
- requester identities;
- reasons;
- moderation state;
- approval history;
- execution history;
- errors.

## B. Synthetic PiGallery2 metadata

Mirror only the current workflow state into PiGallery2's indexed media metadata using synthetic keywords/tags.

Examples:

    pg-curation:delete-pending
    pg-curation:delete-approved
    pg-curation:delete-error

These tags exist only to make the affected media discoverable through PiGallery2's native search / saved-search / logical album functionality.

They are **not authoritative data**.

If PiGallery2's database is rebuilt, the extension must be able to reconstruct these synthetic tags from `curation.sqlite`.

Do not write these internal `pg-curation:*` tags to the actual XMP sidecars.

---

# 4. PiGallery2 APIs / Existing Patterns to Inspect

Before implementing anything, inspect the exact local PiGallery2 source version.

In particular, locate and understand:

1. The official/sample PiGallery2 extension.
2. The current extension interface definitions.
3. Media-button registration.
4. Popup/confirmation configuration.
5. Authenticated extension endpoints.
6. The callback signature that supplies:
   - authenticated user;
   - selected/resolved `MediaEntity`.
7. Extension-owned API routes.
8. Extension database support, if any.
9. Metadata-loading/indexing lifecycle hooks.
10. Access to PiGallery2's internal `ObjectManagers`.
11. `AlbumManager`.
12. `SearchManager`.
13. Any equivalent to:

       AlbumManager.addIfNotExistSavedSearch(...)

14. The sample-extension pattern that:
   - adds a synthetic keyword to a media record;
   - saves the updated cached media metadata;
   - creates a logical/saved-search album matching that keyword.
15. Role-based button visibility.
16. Current `UIExtensionDTO` / media-button DTOs.
17. How PiGallery2 identifies filesystem-relative media paths.
18. How sidecar file naming is represented, if at all.

Do **not** blindly use class names from this specification if the installed PiGallery2 version has changed. Adapt to the current local interfaces.

Prefer stable/public extension interfaces where possible.

If private/internal PiGallery2 APIs are necessary, isolate them behind a small adapter module so future PiGallery2 upgrades require changes in one place only.

---

# 5. User Workflow

## 5.1 Request deletion

Every eligible photo should expose a media action:

    🗑 Request deletion

This should not be labelled simply "Delete", because nothing is immediately deleted.

When clicked, display a popup.

Example UI:

    Request deletion?

    This photo will not be deleted immediately.
    Your request will be reviewed by an administrator.

    Reason (optional):
    [________________________________]

    ☐ I am sure I want to request deletion

    [Cancel] [Request deletion]

The final action button should ideally remain disabled until the required confirmation checkbox is selected.

Use PiGallery2's existing extension popup/custom-field mechanism if available.

The server must derive the requesting user from the authenticated PiGallery2 session/callback.

Never trust a client-submitted username.

Similarly, obtain the media object/path from PiGallery2's server-side resolved media entity where possible rather than trusting an arbitrary pathname from the browser.

---

# 6. Persistent Database Design

Use SQLite unless there is a compelling reason otherwise.

A normalized model is preferred because multiple users may request deletion of the same photograph.

Suggested schema:

## `deletion_items`

One record per media item that has entered the deletion workflow.

Fields:

    id INTEGER PRIMARY KEY

    relative_path TEXT NOT NULL
    media_type TEXT

    file_size INTEGER
    file_mtime INTEGER

    file_hash TEXT
    hash_algorithm TEXT

    state TEXT NOT NULL

    created_at DATETIME NOT NULL
    updated_at DATETIME NOT NULL

    approved_by_user_id TEXT
    approved_by_user_name TEXT
    approved_at DATETIME

    declined_by_user_id TEXT
    declined_by_user_name TEXT
    declined_at DATETIME

    executed_at DATETIME
    execution_error TEXT

Suggested states:

    PENDING
    APPROVED
    DECLINED
    EXECUTED
    ERROR

A UNIQUE constraint should exist on the stable media identity, initially likely `relative_path`.

Potential future enhancement: maintain both path and fingerprint so moves/renames can potentially be reconciled.

---

## `deletion_requests`

One record per user request.

Fields:

    id INTEGER PRIMARY KEY

    deletion_item_id INTEGER NOT NULL

    requested_by_user_id TEXT NOT NULL
    requested_by_user_name TEXT NOT NULL

    requested_at DATETIME NOT NULL

    reason TEXT

    withdrawn_at DATETIME

    FOREIGN KEY deletion_item_id
      REFERENCES deletion_items(id)

This allows:

    IMG_1234.jpg

    Requested by:
      Anna  — "duplicate"
      Peter — "blurry"
      Bob   — "please remove this photo"

without discarding any history.

Store both:

- PiGallery2 user ID;
- username snapshot.

The username snapshot preserves audit information if a PiGallery2 account is later renamed or deleted.

---

# 7. File Identity / Safety Fingerprint

Do not rely only on a filesystem pathname when eventually deleting files.

When a photo enters the workflow, record useful identity information such as:

- relative path;
- file size;
- modification time;
- preferably a cryptographic hash such as SHA-256.

At minimum, calculate the hash before approval or before final deletion.

Example:

    relative_path:
      2024/Christmas/IMG_1234.jpg

    sha256:
      8e91....

The host-side deletion tool must verify that the current file still matches the approved fingerprint.

If:

    hash(current file) != hash(approved file)

the file must not be deleted automatically.

Instead set:

    state = ERROR

with a message such as:

    File changed since approval; deletion aborted.

This prevents accidental deletion of a different file that later occupies the same pathname.

---

# 8. Synthetic Workflow Tags

Use an internal namespace unlikely to collide with real DigiKam/XMP keywords.

Recommended:

    pg-curation:delete-pending
    pg-curation:delete-approved
    pg-curation:delete-error

Do not use ordinary human tags such as:

    delete
    trash
    pending

because these could collide with actual photo metadata.

Mapping:

    PENDING
      -> pg-curation:delete-pending

    APPROVED
      -> pg-curation:delete-approved

    DECLINED
      -> no synthetic deletion tag

    EXECUTED
      -> file no longer exists

    ERROR
      -> pg-curation:delete-error

The synthetic keywords should exist only in PiGallery2's cached media metadata.

Do not persist them into DigiKam XMP.

---

# 9. Native PiGallery2 Saved Searches / Logical Albums

Create native logical/saved-search albums for administration.

At minimum:

## Deletion requests

Query:

    exact keyword:
    pg-curation:delete-pending

Display name:

    🗑 Deletion requests

This is the administrator's visual review queue.

Opening it should show an ordinary PiGallery2 gallery containing all currently pending deletion requests.

The administrator can therefore use the normal PiGallery2 viewer to inspect:

- full image;
- neighbouring photographs;
- date;
- folder;
- faces;
- EXIF;
- other PiGallery2 metadata.

---

## Approved for deletion

Query:

    exact keyword:
    pg-curation:delete-approved

Display name:

    ✓ Approved for deletion

This acts as the final visual manifest before filesystem deletion.

---

## Optional: Deletion errors

Query:

    exact keyword:
    pg-curation:delete-error

Display name:

    ⚠ Deletion errors

This gives the administrator a native visual list of items that failed deletion safety checks.

---

# 10. Persistence Across Reindexing

Synthetic PiGallery2 keywords may disappear whenever PiGallery2 rebuilds or refreshes media metadata.

Therefore implement an indexing / metadata-loading hook.

Conceptually:

    PiGallery2 loads metadata for:
      2024/Christmas/IMG_1234.jpg

             ↓

    extension queries curation.sqlite

             ↓

    if state == PENDING:
        append pg-curation:delete-pending

    if state == APPROVED:
        append pg-curation:delete-approved

    if state == ERROR:
        append pg-curation:delete-error

             ↓

    PiGallery2 stores its rebuilt cached media record

This means the extension database remains authoritative.

After destroying and rebuilding PiGallery2's entire media database, the review albums should repopulate automatically.

---

# 11. Administrator Moderation Actions

Administrator users should have additional media actions.

At minimum:

    ✓ Approve deletion
    ✕ Decline deletion

Restrict these actions to the appropriate PiGallery2 administrator role.

---

## 11.1 Approve

When clicked:

    Approve deletion?

    Approval does NOT delete this file.

    It only adds the image to the final
    administrator deletion queue.

    ☐ Yes, approve this photo for permanent deletion

    [Cancel] [Approve]

On approval:

1. Verify current record is still eligible for moderation.
2. Update `curation.sqlite`:

       state = APPROVED

       approved_by_user_id
       approved_by_user_name
       approved_at

3. Remove:

       pg-curation:delete-pending

4. Add:

       pg-curation:delete-approved

5. Persist/update the PiGallery2 cached media record.

The media should therefore disappear from:

    Deletion requests

and appear in:

    Approved for deletion

without any filesystem modification.

---

## 11.2 Decline

On decline:

1. Update `curation.sqlite`:

       state = DECLINED

       declined_by_user_id
       declined_by_user_name
       declined_at

2. Remove:

       pg-curation:delete-pending

3. Do not add an approved tag.

The image remains a completely ordinary member of the family archive.

Keep the historical request records for audit purposes.

---

# 12. Duplicate / Multiple Requests

The extension must safely handle multiple family members requesting deletion of the same image.

Possible behaviour:

- If image already has `PENDING` state:
  - add another `deletion_requests` record;
  - do not create duplicate `deletion_items`.
- If the same user clicks Request deletion twice:
  - either reject the duplicate;
  - or make `(deletion_item_id, requested_by_user_id)` unique for active requests.
- If already APPROVED:
  - probably reject new requests as unnecessary.
- If DECLINED and later somebody makes a new request:
  - either reopen the item as PENDING;
  - or create a new moderation cycle.

Prefer preserving history over overwriting previous decisions.

---

# 13. Optional Withdrawal

Nice-to-have:

Allow a requesting user to withdraw their own pending request.

Possible action:

    ↩ Withdraw deletion request

Only withdraw that user's request.

If other active requests remain, the item stays PENDING.

If the withdrawn request was the final active request, remove the pending state/tag.

This is optional for the first version.

---

# 14. Displaying Requester / Reason

The authoritative requester/reason information must remain in `curation.sqlite`.

Do not encode free-text reasons into image keywords.

Do not overwrite actual captions or XMP metadata just to expose workflow information.

Current PiGallery2 extension UI capabilities may not support adding an arbitrary dynamic metadata panel inside the native lightbox.

Therefore use this priority:

## Phase 1

Use PiGallery2's native saved-search album as the visual queue.

Approval/decline buttons act on the selected photo.

Requester/reason information may initially be available through:

- an extension endpoint;
- CLI;
- log;
- simple extension admin view;
- or popup, if current PiGallery2 APIs allow dynamically retrieving it.

## Phase 2

If feasible, implement a small extension-owned review UI showing:

    Deletion request

    Requested by: Anna
    Requested: 10 Aug 2026

    Reason:
    "Duplicate; the next frame is much better."

    [Decline] [Approve]

Do not modify core PiGallery2 unless necessary.

If core modification is needed, prefer a generic reusable extension UI hook rather than a deletion-specific patch.

---

# 15. Host-Side Deletion Tool

Actual deletion must be handled by a separate trusted process outside the PiGallery2 container.

Suggested command:

    pg2-curation-delete

This may be implemented in:

- Python;
- Node.js;
- Go;
- shell plus a safe helper;

but Python would be a reasonable default because SQLite and filesystem safety are straightforward.

The tool reads the same `curation.sqlite`.

PiGallery2 itself does not need filesystem write permissions.

---

# 16. Deletion CLI Behaviour

Support at least:

    pg2-curation-delete --dry-run

and:

    pg2-curation-delete --execute

Dry run should be the default/safest behaviour if no flag is provided.

Example output:

    APPROVED DELETIONS
    --------------------------------------------------

    2024/Christmas/IMG_1234.jpg

    Requested by:
      Anna — "duplicate"

    Approved by:
      admin

    Photo exists:          YES
    Fingerprint matches:   YES
    XMP sidecar found:     YES

    Would delete:
      /photos/2024/Christmas/IMG_1234.jpg
      /photos/2024/Christmas/IMG_1234.jpg.xmp

    --------------------------------------------------

    9 photos approved
    9 matching XMP sidecars
    0 safety errors

    NO FILES HAVE BEEN DELETED.

Execution:

    sudo pg2-curation-delete --execute

should perform the exact same validation and then delete only successfully validated approved files.

---

# 17. Filesystem Safety Requirements

The deletion CLI must be defensive.

The extension database should store only a **relative media path**.

Configure one explicit canonical root, for example:

    /srv/photos/family

For every deletion:

1. Resolve:

       root + relative_path

2. Normalize/canonicalize it.

3. Ensure the final path is still underneath the configured root.

4. Reject:
   - absolute input paths;
   - `..` traversal;
   - symlink escapes if relevant;
   - anything resolving outside the root.

5. Verify the file exists.

6. Verify expected media type if appropriate.

7. Verify size/mtime/hash against approved identity.

8. Only then delete.

Never construct and execute arbitrary shell strings such as:

    rm "$path"

from unvalidated database content.

Prefer direct filesystem APIs such as `unlink()`.

---

# 18. XMP Sidecar Handling

The deletion tool should optionally delete the corresponding DigiKam/XMP sidecar.

Before implementing, inspect the actual library and confirm the naming convention.

Possible conventions include:

    IMG_1234.jpg.xmp

or:

    IMG_1234.xmp

Do not assume.

Make sidecar deletion configurable.

Example:

    delete_sidecars = true

The dry-run output must always show exactly which sidecar will be removed.

Do not remove unrelated files with similar names.

---

# 19. State After Successful Deletion

After successful filesystem removal:

Update:

    state = EXECUTED
    executed_at = timestamp
    execution_error = NULL

Keep the historical database record.

Do not simply delete the row.

This preserves an audit trail.

The PiGallery2 media record may remain temporarily cached until indexing runs.

After execution:

- trigger PiGallery2 indexing if a safe supported mechanism exists;
- otherwise instruct the administrator to run the normal indexing operation;
- or rely on PiGallery2's normal detection behaviour.

Once the media disappears from PiGallery2, there is no need for an `EXECUTED` synthetic tag.

---

# 20. Failure Handling

If deletion cannot safely proceed:

    state = ERROR
    execution_error = descriptive message

Examples:

    file missing
    file hash mismatch
    path escaped configured root
    sidecar handling failure
    filesystem permission denied
    database unavailable

Add:

    pg-curation:delete-error

to the cached media metadata when the media still exists.

This allows the native PiGallery2 album:

    ⚠ Deletion errors

to show problematic images visually.

Never silently skip or force-delete a failed safety check.

---

# 21. Permissions

At least two logical permission levels are needed.

## Normal authenticated user

May:

- browse whatever PiGallery2 already permits them to see;
- request deletion of a media item they are permitted to see;
- provide a reason.

May not:

- approve;
- decline;
- execute deletion;
- access arbitrary curation records for inaccessible media.

## Administrator

May:

- request deletion;
- approve;
- decline;
- inspect queues;
- inspect audit data.

Filesystem execution remains outside PiGallery2 and requires host/server privileges.

Never allow the extension API to reveal or manipulate media that the logged-in user could not normally access through PiGallery2.

---

# 22. Access-Control Safety

Saved-search projections and any extension API must respect existing PiGallery2 user visibility rules.

Do not implement an endpoint that simply does:

    SELECT all pending media

and returns every matching pathname to any authenticated user.

If querying media through PiGallery2 internals, prefer its existing:

- SearchManager;
- SessionManager;
- projected/scoped gallery logic;
- or equivalent current authorization mechanisms.

The extension's database may contain records for images a user cannot access.

That does not mean the user should be able to query those records.

Administration endpoints should require the appropriate role.

---

# 23. Database Placement

Do not rely exclusively on the main PiGallery2 DB for human-generated moderation data.

Preferred:

    persistent volume/
      curation/
        curation.sqlite

The data must survive:

- PiGallery2 media DB deletion;
- full media reindex;
- PiGallery2 upgrade;
- container recreation.

Use SQLite WAL mode if appropriate.

Implement simple schema migrations/versioning from the beginning.

Example:

    schema_version

or a small migration table.

---

# 24. Reconciliation at Startup

At extension startup:

1. Open/migrate `curation.sqlite`.
2. Ensure required saved-search albums exist:
   - Deletion requests;
   - Approved for deletion;
   - optional Deletion errors.
3. Optionally reconcile active curation state against currently indexed PiGallery2 media.
4. Do not perform filesystem modifications.

A full rebuild of synthetic keywords may be done lazily through metadata hooks or explicitly if PiGallery2 provides a safe supported approach.

---

# 25. Proposed Extension Structure

A possible repository structure:

    pigallery2-curation/
    ├── package.json
    ├── src/
    │   ├── extension.ts
    │   ├── api/
    │   │   ├── requestDeletion.ts
    │   │   ├── approveDeletion.ts
    │   │   ├── declineDeletion.ts
    │   │   └── getRequestInfo.ts
    │   ├── db/
    │   │   ├── database.ts
    │   │   ├── migrations.ts
    │   │   └── repository.ts
    │   ├── pigallery/
    │   │   ├── adapter.ts
    │   │   ├── syntheticTags.ts
    │   │   └── savedSearches.ts
    │   ├── indexing/
    │   │   └── restoreCurationTags.ts
    │   └── security/
    │       └── permissions.ts
    ├── cli/
    │   └── pg2-curation-delete.py
    └── tests/

Keep PiGallery2-internal API dependencies inside:

    pigallery/adapter.ts

as much as possible.

---

# 26. Synthetic Tag Constants

Do not scatter strings around the codebase.

Example:

    const CURATION_PREFIX = "pg-curation:";

    const TAG_DELETE_PENDING =
      "pg-curation:delete-pending";

    const TAG_DELETE_APPROVED =
      "pg-curation:delete-approved";

    const TAG_DELETE_ERROR =
      "pg-curation:delete-error";

Provide helper methods such as:

    removeAllCurationTags(metadata)

    applyCurationState(metadata, state)

This makes reindex handling predictable.

---

# 27. API Behaviour / Idempotency

Make write operations idempotent where practical.

Examples:

### Request deletion

Calling twice by the same user should not create endless duplicate rows.

Possible response:

    {
      status: "already_requested"
    }

### Approve

Approving an already approved item should return success/current state, not corrupt history.

### Decline

Reject invalid state transitions.

Implement state transitions centrally.

Example:

    PENDING -> APPROVED
    PENDING -> DECLINED

Do not allow:

    EXECUTED -> PENDING

without an explicit administrative recovery operation.

---

# 28. Audit Trail

Preserve moderation history.

For every action, store:

- user ID;
- username snapshot;
- timestamp;
- action;
- optional reason.

A generalized future table could be:

    curation_events

    id
    deletion_item_id
    event_type
    actor_user_id
    actor_user_name
    created_at
    payload_json

Example events:

    REQUESTED
    REQUEST_WITHDRAWN
    APPROVED
    DECLINED
    DELETE_EXECUTED
    DELETE_FAILED

This is optional for v1 if equivalent information is captured cleanly in the other tables.

---

# 29. Suggested MVP

Do not over-engineer the first implementation.

The MVP should contain:

1. Persistent SQLite database.
2. `Request deletion` media button.
3. Confirmation popup.
4. Optional reason.
5. Authenticated requesting-user capture.
6. `PENDING` workflow state.
7. Synthetic pending keyword.
8. Native PiGallery2 saved-search album:
   `Deletion requests`.
9. Admin-only:
   - Approve;
   - Decline.
10. Synthetic approved keyword.
11. Native saved-search album:
   `Approved for deletion`.
12. Metadata/index hook restoring synthetic tags.
13. Host-side deletion CLI:
   - dry-run;
   - execute.
14. Relative-path safety.
15. File fingerprint check.
16. Optional matching XMP sidecar deletion.
17. Audit timestamps.
18. Tests.

The MVP does **not** require a custom full frontend.

---

# 30. Phase 2 Enhancements

After the MVP works reliably:

### Better admin review information

Expose:

    Requested by
    Reason
    Date requested
    Other requesters

inside a custom extension panel or popup.

### Withdrawal

Allow users to retract pending requests.

### Multiple reasons

Show all requests/reasons for one media item.

### Bulk administration

If PiGallery2 later exposes multi-select:

    select 15 photos
       ->
    Approve selected

Do not patch PiGallery2 specifically for bulk deletion unless there is a compelling reason.

### Curation beyond deletion

The same framework could later support:

    pg-curation:metadata-fix
    pg-curation:face-fix
    pg-curation:wrong-date
    pg-curation:highlight

This extension should therefore preferably be architected as a general **curation/workflow system**, with deletion as the first implemented workflow.

---

# 31. Future General Curation Model

Possible future state:

    PiGallery2 Curation

    🗑 Request deletion
    📅 Wrong date
    👤 Face needs fixing
    🏷 Metadata/tag issue
    ⭐ Suggest as highlight
    📌 Pin/highlight

All user-created workflow records remain in the separate curation DB.

PiGallery2 synthetic tags are merely projections that make native saved-search galleries possible.

DigiKam remains authoritative for actual metadata editing.

---

# 32. Important Non-Goals

Do NOT:

- make PiGallery2 itself writable to the canonical image library;
- directly execute `rm` from a browser action;
- put permanent moderation history only in PiGallery2's cache DB;
- write internal workflow tags to XMP;
- alter DigiKam tags or face metadata;
- create a second media indexing system;
- duplicate all PiGallery2 media metadata into the extension DB;
- trust client-submitted usernames;
- trust arbitrary client-submitted filesystem paths;
- delete an image merely because it is marked APPROVED;
- use shell command interpolation for deletion;
- skip file identity verification;
- expose deletion records across PiGallery2 ACL boundaries.

---

# 33. Acceptance Tests

The finished extension should pass at least these scenarios.

## Request

Given user `anna` can view:

    2024/Christmas/IMG_1234.jpg

when she requests deletion with:

    reason = "duplicate"

then:

- no source file changes;
- no XMP changes;
- one request exists in `curation.sqlite`;
- requester is the authenticated `anna`;
- state becomes PENDING;
- cached media gets `pg-curation:delete-pending`;
- photo appears in `Deletion requests`.

---

## Multiple users

If `bob` requests the same image:

- no duplicate deletion item;
- separate Bob request is recorded;
- both reasons remain available;
- photo remains one item in `Deletion requests`.

---

## Decline

Admin declines:

- state becomes DECLINED;
- pending synthetic keyword disappears;
- photo disappears from `Deletion requests`;
- actual image remains untouched;
- request history remains stored.

---

## Approve

Admin approves:

- state becomes APPROVED;
- approval actor/time stored;
- pending keyword removed;
- approved keyword added;
- photo disappears from `Deletion requests`;
- photo appears in `Approved for deletion`;
- no filesystem deletion occurs.

---

## Reindex

Delete/rebuild PiGallery2's own index DB.

After reindexing:

- curation SQLite still contains the request;
- metadata hook re-adds correct synthetic keyword;
- appropriate saved-search album contains the photo again.

---

## Dry run

Run:

    pg2-curation-delete --dry-run

Expected:

- approved files listed;
- requesting users/reasons shown;
- XMP sidecars shown;
- hashes checked;
- nothing deleted.

---

## Safe execution

Run:

    pg2-curation-delete --execute

with matching fingerprint.

Expected:

- photo removed;
- intended sidecar removed if configured;
- state becomes EXECUTED;
- audit timestamp recorded.

---

## Changed file

Replace the approved file with a different file at the same path.

Run deletion.

Expected:

- hash mismatch;
- nothing deleted;
- state becomes ERROR;
- useful error stored;
- image may appear in `Deletion errors`.

---

## Path attack

Insert a malicious path such as:

    ../../etc/passwd

Expected:

- tool refuses to resolve/delete it;
- nothing outside configured photo root can ever be deleted.

---

# 34. Development Strategy for the Coding Agent

Start by inspecting the local PiGallery2 source and its sample extension.

Do not begin by writing the whole extension from assumptions.

Recommended sequence:

1. Identify installed PiGallery2 version/commit.
2. Run/build the official sample extension locally.
3. Prove that a custom media button can:
   - appear on a photo;
   - show a confirmation popup;
   - receive the authenticated user;
   - receive the media entity.
4. Prove that the sample synthetic-keyword/saved-search pattern works.
5. Build a tiny prototype:
   `Request deletion -> add pending keyword`.
6. Add persistent SQLite storage.
7. Rebuild the PiGallery index and prove synthetic state can be restored.
8. Add admin moderation buttons.
9. Add host-side dry-run CLI.
10. Add safety/fingerprint verification.
11. Only then implement real deletion.
12. Add automated tests.

Before running any destructive filesystem test, use a dedicated temporary test photo library, never the real family archive.

---

# 35. Desired Final Result

The desired user experience is:

    Family member browsing PiGallery2
              │
              │ 🗑 Request deletion
              ▼
        confirmation popup
              │
              ▼
       curation.sqlite
              +
        synthetic tag
              │
              ▼
    Albums → Deletion requests


        Administrator
              │
              ├── Decline
              │
              └── Approve
                    │
                    ▼
       Albums → Approved for deletion
                    │
                    ▼
           host-side dry run
                    │
                    ▼
            host-side execute
                    │
                    ▼
             filesystem deletion
                    │
                    ▼
             PiGallery reindex

At all times:

    Filesystem + XMP
       = canonical family archive

    DigiKam
       = authoritative metadata editor

    PiGallery2
       = viewer and review interface

    curation.sqlite
       = durable human workflow/audit data

    PiGallery2 DB
       = disposable searchable index/cache

    host-side deletion CLI
       = only component authorized to permanently remove files
