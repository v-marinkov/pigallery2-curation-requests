# PiGallery2 Curation CLI

These host-side commands inspect curation requests and execute only approved deletion work. Run them on the Docker host, not inside the read-only PiGallery2 container.

## Configuration

Copy `.env.example` to `.env` in this directory:

```bash
cp .env.example .env
```

Example:

```dotenv
PG2_CURATION_DB=/opt/pigallery2/curation/curation.sqlite
PG2_PHOTO_ROOT=/srv/photos/family

# none, appended (photo.jpg.xmp), or stem (photo.xmp)
PG2_SIDECAR_STYLE=none
```

The scripts look for `.env` in the current directory and then beside the script. Command-line options override `.env` values.

`PG2_CURATION_DB` and `PG2_PHOTO_ROOT` are paths on the Docker host. The database path should identify the same file that the PiGallery2 container sees through its curation bind mount. The photo root must be the canonical host directory corresponding to PiGallery2's read-only `/app/data/images` mount.

## Review requests

Show the active queues—open metadata requests plus pending and approved deletions:

```bash
python3 pg2_curation_review.py
```

Filter by state:

```bash
python3 pg2_curation_review.py --state PENDING
python3 pg2_curation_review.py --state APPROVED
python3 pg2_curation_review.py --state OPEN
python3 pg2_curation_review.py --state RESOLVED
python3 pg2_curation_review.py --state DISMISSED
python3 pg2_curation_review.py --state WITHDRAWN
python3 pg2_curation_review.py --state ERROR
python3 pg2_curation_review.py --state EXECUTED
python3 pg2_curation_review.py --state ALL
```

## Delete approved items

Always run a dry run first. Dry run is also the default when neither mode flag is supplied:

```bash
./pg2-curation-delete --dry-run
```

Verify every listed path, require `Fingerprint matches: YES`, and require `0 safety errors`.

Then execute the approved queue:

```bash
./pg2-curation-delete --execute
```

The command processes **only deletion items currently in `APPROVED` state**. Metadata correction requests can never enter this executor. It verifies root containment, file size, modification time, and SHA-256 before deletion. Immediately before unlinking, it locks and rechecks the queue entry; an item cancelled since the initial queue read is safely skipped. Successful records become `EXECUTED`; failures become `ERROR`.

Run it as the least-privileged host account that can write the photo root and curation database. Root is not intrinsically required.

After execution, run PiGallery2's indexing job so deleted photos disappear from the gallery.

## Sidecars

Sidecar deletion defaults to `none`. Set the convention only after checking actual files:

- `none`: do not delete XMP files.
- `appended`: delete `photo.jpg.xmp`.
- `stem`: delete `photo.xmp`.

Be careful with `stem` when RAW and JPEG files share one XMP sidecar.

## Help

```bash
python3 pg2_curation_review.py --help
python3 pg2_curation_delete.py --help
```
