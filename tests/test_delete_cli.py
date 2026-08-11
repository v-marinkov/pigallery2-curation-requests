from __future__ import annotations

import hashlib
import io
import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from cli import pg2_curation_delete as deletion_cli
from cli import pg2_curation_review as review_cli


SCHEMA = """
CREATE TABLE deletion_items (
  id INTEGER PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  file_size INTEGER,
  file_mtime INTEGER,
  file_hash TEXT,
  hash_algorithm TEXT,
  state TEXT NOT NULL,
  current_cycle INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT 'now',
  updated_at TEXT NOT NULL,
  executed_at TEXT,
  execution_error TEXT,
  approved_by_user_name TEXT,
  approved_at TEXT,
  declined_by_user_name TEXT,
  declined_at TEXT
);
CREATE TABLE deletion_requests (
  id INTEGER PRIMARY KEY,
  deletion_item_id INTEGER NOT NULL,
  cycle INTEGER NOT NULL,
  requested_by_user_name TEXT NOT NULL,
  reason TEXT,
  requested_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE TABLE curation_events (
  id INTEGER PRIMARY KEY,
  deletion_item_id INTEGER NOT NULL,
  cycle INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_user_name TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT
);
CREATE TABLE curation_media (
  id INTEGER PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  media_type TEXT,
  public_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE metadata_requests (
  id INTEGER PRIMARY KEY,
  curation_media_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  state TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  requested_by_user_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  comment TEXT,
  updated_at TEXT NOT NULL,
  approved_by_user_id TEXT,
  approved_by_user_name TEXT,
  approved_at TEXT,
  closed_by_user_id TEXT,
  closed_by_user_name TEXT,
  closed_at TEXT,
  resolution_comment TEXT
);
"""


@contextmanager
def database_connection(path: Path):
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


class DeletionCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="pg2-delete-cli-")
        self.root = Path(self.temp.name) / "photos"
        self.root.mkdir()
        self.database = Path(self.temp.name) / "curation.sqlite"
        with database_connection(self.database) as connection:
            connection.executescript(SCHEMA)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def add_approved(self, relative_path: str, content: bytes, *, hash_override: str | None = None) -> Path:
        photo = self.root / relative_path
        photo.parent.mkdir(parents=True, exist_ok=True)
        photo.write_bytes(content)
        stat = photo.stat()
        digest = hash_override or hashlib.sha256(content).hexdigest()
        with database_connection(self.database) as connection:
            cursor = connection.execute(
                """
                INSERT INTO deletion_items(
                  relative_path, file_size, file_mtime, file_hash, hash_algorithm,
                  state, current_cycle, updated_at, approved_by_user_name
                ) VALUES (?, ?, ?, ?, 'sha256', 'APPROVED', 1, 'now', 'admin')
                """,
                (relative_path, stat.st_size, stat.st_mtime_ns // 1_000_000, digest),
            )
            connection.execute(
                """
                INSERT INTO deletion_requests(
                  deletion_item_id, cycle, requested_by_user_name, reason, requested_at
                ) VALUES (?, 1, 'anna', 'duplicate', 'now')
                """,
                (cursor.lastrowid,),
            )
        return photo

    def invoke(self, *, execute: bool, sidecar_style: str = "none") -> int:
        with redirect_stdout(io.StringIO()):
            return deletion_cli.run(self.database, self.root, execute, sidecar_style)

    def state(self) -> tuple[str, str | None]:
        with database_connection(self.database) as connection:
            return connection.execute(
                "SELECT state, execution_error FROM deletion_items ORDER BY id DESC LIMIT 1"
            ).fetchone()

    def test_dry_run_is_default_safe_behavior(self) -> None:
        photo = self.add_approved("2024/photo.jpg", b"photo")
        self.assertEqual(self.invoke(execute=False), 0)
        self.assertTrue(photo.exists())
        self.assertEqual(self.state(), ("APPROVED", None))

    def test_review_cli_exposes_requester_and_reason_to_host_admin(self) -> None:
        self.add_approved("2024/photo.jpg", b"photo")
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(review_cli.run(self.database, "APPROVED"), 0)
        self.assertIn("2024/photo.jpg", output.getvalue())
        self.assertIn("anna", output.getvalue())
        self.assertIn("duplicate", output.getvalue())

    def test_review_active_view_contains_pending_and_approved_only(self) -> None:
        self.add_approved("approved.jpg", b"approved")
        pending = self.add_approved("pending.jpg", b"pending")
        declined = self.add_approved("declined.jpg", b"declined")
        with database_connection(self.database) as connection:
            connection.execute(
                "UPDATE deletion_items SET state = 'PENDING' WHERE relative_path = 'pending.jpg'"
            )
            connection.execute(
                "UPDATE deletion_items SET state = 'DECLINED' WHERE relative_path = 'declined.jpg'"
            )
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(review_cli.run(self.database, "ACTIVE"), 0)
        report = output.getvalue()
        self.assertIn("approved.jpg", report)
        self.assertIn("pending.jpg", report)
        self.assertNotIn("declined.jpg", report)

    def test_review_active_view_also_reports_open_metadata_requests(self) -> None:
        with database_connection(self.database) as connection:
            media = connection.execute(
                """
                INSERT INTO curation_media(
                  relative_path, media_type, public_token, created_at, updated_at
                ) VALUES ('2024/metadata.jpg', 'photo', ?, 'now', 'now')
                """,
                ("a" * 32,),
            )
            connection.execute(
                """
                INSERT INTO metadata_requests(
                  curation_media_id, category, state,
                  requested_by_user_id, requested_by_user_name,
                  requested_at, comment, updated_at
                ) VALUES (?, 'faces', 'OPEN', '1', 'anna', 'now', 'Missing Alice', 'now')
                """,
                (media.lastrowid,),
            )
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(review_cli.run(self.database, "ACTIVE"), 0)
        report = output.getvalue()
        self.assertIn("METADATA REQUESTS: ACTIVE", report)
        self.assertIn("2024/metadata.jpg", report)
        self.assertIn("faces", report)
        self.assertIn("Missing Alice", report)

    def test_review_approved_filter_includes_accepted_metadata_work(self) -> None:
        with database_connection(self.database) as connection:
            media = connection.execute(
                """
                INSERT INTO curation_media(
                  relative_path, media_type, public_token, created_at, updated_at
                ) VALUES ('2024/approved-metadata.jpg', 'photo', ?, 'now', 'now')
                """,
                ("b" * 32,),
            )
            connection.execute(
                """
                INSERT INTO metadata_requests(
                  curation_media_id, category, state,
                  requested_by_user_id, requested_by_user_name,
                  requested_at, comment, updated_at,
                  approved_by_user_id, approved_by_user_name, approved_at
                ) VALUES (?, 'location', 'OPEN', '1', 'anna', 'now',
                          'Wrong city', 'now', '9', 'admin', 'later')
                """,
                (media.lastrowid,),
            )
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(review_cli.run(self.database, "APPROVED"), 0)
        report = output.getvalue()
        self.assertIn("approved-metadata.jpg", report)
        self.assertIn("State:       APPROVED", report)
        self.assertIn("Approved:    admin @ later", report)

    def test_execute_deletes_matching_photo_and_selected_sidecar(self) -> None:
        photo = self.add_approved("2024/photo.jpg", b"photo")
        sidecar = Path(str(photo) + ".xmp")
        sidecar.write_text("xmp", encoding="utf-8")
        self.assertEqual(self.invoke(execute=True, sidecar_style="appended"), 0)
        self.assertFalse(photo.exists())
        self.assertFalse(sidecar.exists())
        self.assertEqual(self.state(), ("EXECUTED", None))

    def test_execute_skips_item_cancelled_after_initial_queue_read(self) -> None:
        photo = self.add_approved("2024/photo.jpg", b"photo")
        original_validate = deletion_cli.validate_item

        def cancel_after_validation(item, photo_root, sidecar_style):
            validated = original_validate(item, photo_root, sidecar_style)
            with database_connection(self.database) as connection:
                connection.execute(
                    "UPDATE deletion_items SET state = 'DECLINED' WHERE id = ?",
                    (item.id,),
                )
            return validated

        output = io.StringIO()
        with patch.object(deletion_cli, "validate_item", side_effect=cancel_after_validation):
            with redirect_stdout(output):
                self.assertEqual(
                    deletion_cli.run(self.database, self.root, True, "none"),
                    0,
                )

        self.assertTrue(photo.exists())
        self.assertEqual(self.state(), ("DECLINED", None))
        self.assertIn("SKIPPED:", output.getvalue())
        self.assertIn("1 skipped because queue state changed", output.getvalue())

    def test_hash_mismatch_never_deletes_and_marks_error_on_execute(self) -> None:
        photo = self.add_approved("photo.jpg", b"replacement", hash_override="0" * 64)
        self.assertEqual(self.invoke(execute=True), 1)
        self.assertTrue(photo.exists())
        state, error = self.state()
        self.assertEqual(state, "ERROR")
        self.assertIn("SHA-256", error)

    def test_sidecar_symlink_is_never_followed(self) -> None:
        photo = self.add_approved("photo.jpg", b"photo")
        outside = Path(self.temp.name) / "unrelated.xmp"
        outside.write_text("keep", encoding="utf-8")
        Path(str(photo) + ".xmp").symlink_to(outside)
        self.assertEqual(self.invoke(execute=True, sidecar_style="appended"), 1)
        self.assertTrue(photo.exists())
        self.assertEqual(outside.read_text(encoding="utf-8"), "keep")
        self.assertEqual(self.state()[0], "ERROR")

    def test_path_traversal_cannot_reach_outside_root(self) -> None:
        outside = Path(self.temp.name) / "outside.jpg"
        outside.write_bytes(b"do not delete")
        stat = outside.stat()
        with database_connection(self.database) as connection:
            connection.execute(
                """
                INSERT INTO deletion_items(
                  relative_path, file_size, file_mtime, file_hash, hash_algorithm,
                  state, current_cycle, updated_at, approved_by_user_name
                ) VALUES ('../outside.jpg', ?, ?, ?, 'sha256', 'APPROVED', 1, 'now', 'admin')
                """,
                (stat.st_size, stat.st_mtime_ns // 1_000_000, hashlib.sha256(outside.read_bytes()).hexdigest()),
            )
        self.assertEqual(self.invoke(execute=True), 1)
        self.assertTrue(outside.exists())
        self.assertEqual(self.state()[0], "ERROR")


class LocalEnvironmentConfigTests(unittest.TestCase):
    def test_both_commands_load_dotenv_from_current_directory(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-cli-env-") as folder:
            config_dir = Path(folder)
            database = config_dir / "curation.sqlite"
            photo_root = config_dir / "photos"
            (config_dir / ".env").write_text(
                "\n".join(
                    (
                        f"PG2_CURATION_DB={database}",
                        f"PG2_PHOTO_ROOT={photo_root}",
                        "PG2_SIDECAR_STYLE=appended",
                    )
                ),
                encoding="utf-8",
            )
            previous_cwd = Path.cwd()
            try:
                os.chdir(config_dir)
                with patch.dict(
                    os.environ,
                    {"PG2_CURATION_DB": "", "PG2_PHOTO_ROOT": "", "PG2_SIDECAR_STYLE": ""},
                ):
                    delete_args = deletion_cli.build_parser().parse_args([])
                    review_args = review_cli.build_parser().parse_args([])
                self.assertEqual(delete_args.database, database)
                self.assertEqual(delete_args.photo_root, photo_root)
                self.assertEqual(delete_args.sidecar_style, "appended")
                self.assertEqual(review_args.database, database)
                self.assertEqual(review_args.state, "ACTIVE")
            finally:
                os.chdir(previous_cwd)

    def test_command_line_database_overrides_dotenv(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-cli-env-") as folder:
            config_dir = Path(folder)
            (config_dir / ".env").write_text("PG2_CURATION_DB=/from-env.sqlite\n", encoding="utf-8")
            previous_cwd = Path.cwd()
            try:
                os.chdir(config_dir)
                with patch.dict(os.environ, {"PG2_CURATION_DB": ""}):
                    args = review_cli.build_parser().parse_args(["--database", "/override.sqlite"])
                self.assertEqual(args.database, Path("/override.sqlite"))
            finally:
                os.chdir(previous_cwd)

    def test_invalid_sidecar_setting_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-cli-env-") as folder:
            config_dir = Path(folder)
            (config_dir / ".env").write_text(
                "PG2_PHOTO_ROOT=/photos\nPG2_SIDECAR_STYLE=guess\n", encoding="utf-8"
            )
            previous_cwd = Path.cwd()
            try:
                os.chdir(config_dir)
                with patch.dict(os.environ, {"PG2_PHOTO_ROOT": "", "PG2_SIDECAR_STYLE": ""}):
                    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                        self.assertEqual(deletion_cli.main([]), 2)
            finally:
                os.chdir(previous_cwd)


if __name__ == "__main__":
    unittest.main()
