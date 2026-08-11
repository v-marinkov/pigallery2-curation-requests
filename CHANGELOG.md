# Changelog

## 0.4.0

- Renamed the project to PiGallery2 Curation Requests.
- Added general correction categories for faces, tags, location, date/time, title/caption, duplicates, and other issues.
- Added a migration-safe metadata request queue with open, resolved, dismissed, and withdrawn states.
- Added authenticated in-gallery request details and comments without projecting comment text into keywords.
- Added flat category saved searches alongside the existing deletion queues.
- Added a per-user, browser-local Curation mode toggle inside PiGallery2's Tools submenu.
- Simplified the request popup by removing repeated checkbox headings and adding visual category icons.
- Made deletion an exclusive, server-enforced request choice and prioritized its red moderation action over metadata controls.
- Grouped metadata choices above deletion, added per-user deletion ownership visibility, moved the details badge, and removed repeated confirmation headings.
- Restored concurrent admin moderation controls, visually separated their pairs, and matched the details button to the circular hover treatment.
- Added authenticated per-request metadata approval/decline in the details dialog and hid metadata moderation after deletion approval.
- Exposed the existing photo-level deletion approval/decline operations alongside deletion rows in the details dialog.
- Added ownership-checked row cancellation, a native My curation requests search shortcut, and the Bootstrap modal close control.
- Split metadata acceptance from completion: approved requests remain visible until marked done, declined, or cancelled by their owner.
- Renamed the per-row owner action to Cancel and hid that redundant action from administrators.
- Added explicit pending/approved metadata projection tags and saved searches.
- Replaced the batch Resolve/Dismiss pair with state-dependent Approve all/Mark all done and Decline all controls.
- Made granular and batch approval consistently blue while retaining green for Mark done.
- Locked approved-deletion photos against all new metadata and deletion requests at both repository and frontend levels.
- Moved all photo-level batch controls into a permission-aware panel at the top of the request-details dialog and hid their native overlay icons.
- Kept Cancel my requests visually separate from administrator-only batch moderation while preserving individual row controls below.
- Allowed the native Request curation modal to close when its outer backdrop area is clicked.
- Renamed the browser asset to `pg2-curation-script.js` and retained configurable legacy deployment filenames.
- Made installation preserve existing custom head code and CLI settings by default, create a one-time PiGallery config backup, and validate required Compose mounts before changing config.
- Expanded public installation, component, workflow, mutation-risk, optional-feature, and manual configuration documentation.
- Extended the host review report to include metadata correction requests while keeping the deletion executor deletion-only.
- Preserved the existing deletion schema, approval fingerprints, queue locking, and defensive executor.

## 0.3.0

- Added authenticated frontend permission synchronization.
- Added secure own-request withdrawal with multiple-requester handling.
- Added cancellation of final pending, approved, or failed requests while retaining audit history.
- Added final SQLite queue locking before host-side deletion.
- Allowed administrators to decline approved and failed deletion work.
- Added state-aware frontend visibility and automatic browser-asset cache tags.
- Added configurable SSH deployment, first-install dependency setup, CLI deployment, and container recreation.
- Added a server-local, `.env`-driven installer/updater that configures extension settings and frontend injection without SSH or SCP.
- Added universal `.env` examples, manual installation tooling, CI, security policy, and public documentation.

## 0.2.0

- Added requester allowlists, administrator moderation guards, requester projections, saved searches, and host review reporting.

## 0.1.0

- Initial deletion-request, approval, SQLite audit, fingerprint, and host deletion workflow.
