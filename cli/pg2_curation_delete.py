#!/usr/bin/env python3
"""Safely execute deletion requests approved in pigallery2-curation."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Sequence


class SafetyError(RuntimeError):
    pass


class QueueStateChanged(RuntimeError):
    pass


def load_local_env() -> dict[str, str]:
    """Load a small, non-executable .env file from cwd or the script directory."""
    candidates = [Path.cwd() / ".env", Path(__file__).resolve().parent / ".env"]
    result: dict[str, str] = {}
    seen: set[Path] = set()
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        for line_number, raw_line in enumerate(candidate.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            if "=" not in line:
                raise ValueError(f"{candidate}:{line_number}: expected KEY=VALUE")
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                raise ValueError(f"{candidate}:{line_number}: invalid setting name")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            result.setdefault(key, value)
        break
    return result


def configured_value(local_env: dict[str, str], key: str, fallback: str | None = None) -> str | None:
    return os.environ.get(key) or local_env.get(key) or fallback


@dataclass(frozen=True)
class ApprovedItem:
    id: int
    relative_path: str
    file_size: int | None
    file_mtime: int | None
    file_hash: str | None
    hash_algorithm: str | None
    current_cycle: int
    approved_by_user_name: str | None


@dataclass(frozen=True)
class ValidatedFile:
    item: ApprovedItem
    media_path: Path
    sidecar_path: Path | None
    device: int
    inode: int
    sidecar_device: int | None
    sidecar_inode: int | None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_relative_path(value: str) -> PurePosixPath:
    if not value or "\x00" in value or "\\" in value:
        raise SafetyError("invalid relative media path")
    if re.match(r"^[A-Za-z]:/", value):
        raise SafetyError("absolute Windows paths are not allowed")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
        raise SafetyError("path is not a normalized relative media path")
    return relative


def ensure_inside_root(path: Path, root: Path) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise SafetyError("file is missing") from exc
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise SafetyError("resolved path escapes the configured photo root") from exc
    return resolved


def sidecar_for(media_path: Path, style: str, root: Path) -> tuple[Path | None, int | None, int | None]:
    if style not in ("none", "appended", "stem"):
        raise SafetyError(f"unsupported XMP sidecar style: {style}")
    if style == "none":
        return None, None, None
    candidate = (
        Path(str(media_path) + ".xmp")
        if style == "appended"
        else media_path.with_suffix(".xmp")
    )
    if not candidate.exists():
        return None, None, None
    if candidate.is_symlink():
        raise SafetyError("XMP sidecar path is a symbolic link")
    resolved = ensure_inside_root(candidate, root)
    if not resolved.is_file():
        raise SafetyError("XMP sidecar is not a regular file")
    stat = os.lstat(resolved)
    return resolved, stat.st_dev, stat.st_ino


def fingerprint_open_file(path: Path) -> tuple[int, int, str, int, int]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise SafetyError(f"cannot open media safely: {exc}") from exc
    digest = hashlib.sha256()
    with os.fdopen(descriptor, "rb", closefd=True) as handle:
        before = os.fstat(handle.fileno())
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
        after = os.fstat(handle.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise SafetyError("file changed while its fingerprint was being calculated")
    return after.st_size, after.st_mtime_ns // 1_000_000, digest.hexdigest(), after.st_dev, after.st_ino


def validate_item(item: ApprovedItem, photo_root: Path, sidecar_style: str) -> ValidatedFile:
    relative = parse_relative_path(item.relative_path)
    lexical_path = photo_root.joinpath(*relative.parts)
    if lexical_path.is_symlink():
        raise SafetyError("media path is a symbolic link")
    media_path = ensure_inside_root(lexical_path, photo_root)
    if not media_path.is_file():
        raise SafetyError("media path is not a regular file")
    if item.hash_algorithm != "sha256" or not item.file_hash:
        raise SafetyError("approved item has no supported SHA-256 fingerprint")

    size, mtime, digest, device, inode = fingerprint_open_file(media_path)
    if item.file_size is None or size != item.file_size:
        raise SafetyError(f"file size changed (approved {item.file_size}, current {size})")
    if item.file_mtime is None or mtime != item.file_mtime:
        raise SafetyError(f"file modification time changed (approved {item.file_mtime}, current {mtime})")
    if not hmac.compare_digest(digest.lower(), item.file_hash.lower()):
        raise SafetyError("file SHA-256 changed since approval")

    sidecar_path, sidecar_device, sidecar_inode = sidecar_for(media_path, sidecar_style, photo_root)
    return ValidatedFile(item, media_path, sidecar_path, device, inode, sidecar_device, sidecar_inode)


def approved_items(connection: sqlite3.Connection) -> list[ApprovedItem]:
    rows = connection.execute(
        """
        SELECT id, relative_path, file_size, file_mtime, file_hash, hash_algorithm,
               current_cycle, approved_by_user_name
          FROM deletion_items
         WHERE state = 'APPROVED'
         ORDER BY relative_path
        """
    ).fetchall()
    return [ApprovedItem(**dict(row)) for row in rows]


def requests_for(connection: sqlite3.Connection, item: ApprovedItem) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT requested_by_user_name, reason
          FROM deletion_requests
         WHERE deletion_item_id = ? AND cycle = ? AND withdrawn_at IS NULL
         ORDER BY requested_at, id
        """,
        (item.id, item.current_cycle),
    ).fetchall()


def record_result(
    connection: sqlite3.Connection, item: ApprovedItem, state: str, error: str | None
) -> bool:
    timestamp = utc_now()
    executed_at = timestamp if state == "EXECUTED" else None
    changed = connection.execute(
        """
        UPDATE deletion_items
           SET state = ?, updated_at = ?, executed_at = ?, execution_error = ?
         WHERE id = ? AND current_cycle = ? AND state = 'APPROVED'
        """,
        (state, timestamp, executed_at, error, item.id, item.current_cycle),
    )
    if changed.rowcount != 1:
        return False
    connection.execute(
        """
        INSERT INTO curation_events(
          deletion_item_id, cycle, event_type, actor_user_id, actor_user_name,
          created_at, payload_json
        ) VALUES (?, ?, ?, NULL, 'pg2-curation-delete', ?, ?)
        """,
        (
            item.id,
            item.current_cycle,
            "DELETE_EXECUTED" if state == "EXECUTED" else "DELETE_FAILED",
            timestamp,
            None if error is None else json.dumps({"error": error}),
        ),
    )
    return True


def recheck_identity(validated: ValidatedFile) -> None:
    try:
        current = os.lstat(validated.media_path)
    except FileNotFoundError as exc:
        raise SafetyError("file disappeared before deletion") from exc
    if (current.st_dev, current.st_ino) != (validated.device, validated.inode):
        raise SafetyError("file identity changed immediately before deletion")
    if validated.sidecar_path:
        try:
            sidecar = os.lstat(validated.sidecar_path)
        except FileNotFoundError as exc:
            raise SafetyError("XMP sidecar disappeared before deletion") from exc
        if (sidecar.st_dev, sidecar.st_ino) != (validated.sidecar_device, validated.sidecar_inode):
            raise SafetyError("XMP sidecar identity changed immediately before deletion")


def execute_validated(connection: sqlite3.Connection, validated: ValidatedFile) -> None:
    """Serialize final queue validation, cancellation, and filesystem deletion."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        current = connection.execute(
            "SELECT state, current_cycle FROM deletion_items WHERE id = ?",
            (validated.item.id,),
        ).fetchone()
        if (
            current is None
            or current["state"] != "APPROVED"
            or current["current_cycle"] != validated.item.current_cycle
        ):
            raise QueueStateChanged("item is no longer approved; it may have been cancelled")

        recheck_identity(validated)
        validated.media_path.unlink()
        if validated.sidecar_path:
            validated.sidecar_path.unlink()
        if not record_result(connection, validated.item, "EXECUTED", None):
            raise QueueStateChanged("item left the approved queue before deletion")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def show_item(
    connection: sqlite3.Connection,
    validated: ValidatedFile | None,
    item: ApprovedItem,
    error: str | None,
    skipped: str | None = None,
) -> None:
    print("-" * 72)
    print(item.relative_path)
    print("Requested by:")
    for request in requests_for(connection, item):
        reason = f' — "{request["reason"]}"' if request["reason"] else ""
        print(f'  {request["requested_by_user_name"]}{reason}')
    print(f"Approved by:          {item.approved_by_user_name or '(unknown)'}")
    print(f"Photo exists:         {'YES' if validated else 'NO/UNSAFE'}")
    print(f"Fingerprint matches:  {'YES' if validated else 'NO'}")
    if validated:
        print(f"XMP sidecar found:    {'YES' if validated.sidecar_path else 'NO'}")
        print("Would delete:")
        print(f"  {validated.media_path}")
        if validated.sidecar_path:
            print(f"  {validated.sidecar_path}")
    if error:
        print(f"SAFETY ERROR:         {error}")
    if skipped:
        print(f"SKIPPED:              {skipped}")


def run(database: Path, photo_root: Path, execute: bool, sidecar_style: str) -> int:
    if not database.is_file():
        print(f"ERROR: curation database does not exist: {database}", file=sys.stderr)
        return 2
    try:
        root = photo_root.resolve(strict=True)
    except FileNotFoundError:
        print(f"ERROR: photo root does not exist: {photo_root}", file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f"ERROR: photo root is not a directory: {root}", file=sys.stderr)
        return 2

    connection = sqlite3.connect(database, timeout=5)
    connection.row_factory = sqlite3.Row
    try:
        items = approved_items(connection)
    except sqlite3.DatabaseError as exc:
        print(f"ERROR: invalid or unavailable curation database: {exc}", file=sys.stderr)
        connection.close()
        return 2

    print("APPROVED DELETIONS")
    print("=" * 72)
    successes = 0
    errors = 0
    sidecars = 0
    skipped = 0

    for item in items:
        validated: ValidatedFile | None = None
        error: str | None = None
        skip_reason: str | None = None
        try:
            validated = validate_item(item, root, sidecar_style)
            if execute:
                execute_validated(connection, validated)
            successes += 1
            sidecars += int(validated.sidecar_path is not None)
        except QueueStateChanged as exc:
            skip_reason = str(exc)
            skipped += 1
        except (OSError, SafetyError) as exc:
            error = str(exc)
            if execute:
                with connection:
                    recorded = record_result(connection, item, "ERROR", error)
                if not recorded:
                    skip_reason = "item is no longer approved; safety error was not recorded"
                    error = None
                    skipped += 1
                else:
                    errors += 1
            else:
                errors += 1
        show_item(connection, validated, item, error, skip_reason)

    print("-" * 72)
    action = "Deleted" if execute else "Validated"
    print(f"{len(items)} photos approved")
    print(f"{successes} safely {action.lower()}")
    print(f"{sidecars} matching XMP sidecars")
    print(f"{skipped} skipped because queue state changed")
    print(f"{errors} safety errors")
    if execute:
        print("EXECUTION COMPLETE. Run or schedule PiGallery2 indexing next.")
    else:
        print("NO FILES HAVE BEEN DELETED.")
    connection.close()
    return 1 if errors else 0


def build_parser() -> argparse.ArgumentParser:
    local_env = load_local_env()
    configured_database = configured_value(local_env, "PG2_CURATION_DB")
    configured_photo_root = configured_value(local_env, "PG2_PHOTO_ROOT")
    configured_sidecar_style = configured_value(local_env, "PG2_SIDECAR_STYLE", "none")
    if configured_sidecar_style not in ("none", "appended", "stem"):
        raise ValueError(
            "PG2_SIDECAR_STYLE in the environment or .env must be none, appended, or stem"
        )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(configured_database) if configured_database else None,
        required=configured_database is None,
        help="curation.sqlite path (overrides PG2_CURATION_DB from the environment or local .env)",
    )
    parser.add_argument(
        "--photo-root",
        type=Path,
        default=Path(configured_photo_root) if configured_photo_root else None,
        required=configured_photo_root is None,
        help="canonical writable photo root (overrides PG2_PHOTO_ROOT from the environment or local .env)",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="validate and report without deleting (default)")
    mode.add_argument("--execute", action="store_true", help="delete only safely validated approved files")
    parser.add_argument(
        "--sidecar-style",
        choices=("none", "appended", "stem"),
        default=configured_sidecar_style,
        help="none, appended (IMG.jpg.xmp), or stem (IMG.xmp); environment/local .env default: none",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        parser = build_parser()
    except (OSError, ValueError) as exc:
        print(f"ERROR: invalid local .env configuration: {exc}", file=sys.stderr)
        return 2
    arguments = parser.parse_args(argv)
    return run(arguments.database, arguments.photo_root, arguments.execute, arguments.sidecar_style)


if __name__ == "__main__":
    raise SystemExit(main())
