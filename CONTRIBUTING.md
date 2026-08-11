# Contributing

Contributions are welcome, particularly compatibility fixes for newer PiGallery2 releases, tests, documentation improvements, and narrowly scoped security hardening.

## Development setup

Requirements:

- Node.js 22
- npm
- Python 3.10 or newer

Install and test:

```bash
npm ci
npm test
```

The TypeScript build writes the production JavaScript files beside their sources. Commit source and generated production JavaScript together so a release can be installed without a compiler on the PiGallery2 server.

## Pull requests

- Keep PiGallery2's image mount read-only.
- Treat browser visibility rules only as usability features; enforce every permission again on the server.
- Add tests for state transitions, comment visibility, authorization, migrations, and destructive-operation safety.
- Never put real server addresses, usernames, photo paths, databases, or `.env` files in commits or test fixtures.
- Run `npm test` before opening a pull request.
