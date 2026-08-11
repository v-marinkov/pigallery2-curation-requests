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
