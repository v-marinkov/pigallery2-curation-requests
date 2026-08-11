# Security policy

## Reporting a vulnerability

Do not publish an exploitable deletion, path-validation, authorization, or SQL issue in a public issue before a fix is available. Use GitHub's private vulnerability reporting feature for the repository. Include the affected version, reproduction steps, expected impact, and any relevant PiGallery2 or Docker configuration.

## Security boundary

PiGallery2 and this extension are designed to keep the photo library mounted read-only. The separate host-side deletion command is the only component that should receive write access to the library. The browser JavaScript is presentation logic and is never an authorization boundary.

Before executing approved deletions, keep a current backup and run the CLI in dry-run mode. A deployment that gives the PiGallery2 container write access to the library is outside this project's intended security model.
