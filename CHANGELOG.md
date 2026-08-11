# Changelog

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
