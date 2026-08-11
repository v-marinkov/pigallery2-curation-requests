from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import set_custom_html_head


class CustomHtmlHeadTests(unittest.TestCase):
    def test_updates_only_server_custom_html_head_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-custom-head-") as folder:
            root = Path(folder)
            config_path = root / "config.json"
            asset_path = root / "pg2-curation-script.js"
            config_path.write_text(
                json.dumps({"Server": {"applicationTitle": "Family"}, "Database": {"type": "sqlite"}}),
                encoding="utf-8",
            )
            asset_path.write_text("console.log('curation');\n", encoding="utf-8")

            cache_tag = set_custom_html_head.asset_cache_tag(asset_path)
            self.assertEqual(len(cache_tag), 12)
            settings = (
                "curation-requests",
                "/app/data/curation/curation.sqlite",
                "admin, family-user",
                2000,
            )
            self.assertTrue(set_custom_html_head.update_config(config_path, cache_tag, settings))
            self.assertFalse(set_custom_html_head.update_config(config_path, cache_tag, settings))

            updated = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(updated["Server"]["applicationTitle"], "Family")
            self.assertEqual(updated["Database"], {"type": "sqlite"})
            self.assertIn(f"pg2-curation-script.js?v={cache_tag}", updated["Server"]["customHTMLHead"])
            self.assertIn(set_custom_html_head.LOADER_START, updated["Server"]["customHTMLHead"])
            self.assertTrue((root / "config.json.pg2-curation.bak").is_file())
            self.assertEqual(
                updated["Extensions"]["extensions"]["curation-requests"],
                {
                    "enabled": True,
                    "path": "curation-requests",
                    "configs": {
                        "databasePath": "/app/data/curation/curation.sqlite",
                        "reasonMaxLength": 2000,
                        "requesterAllowlist": "admin, family-user",
                    },
                },
            )

    def test_rejects_a_non_object_server_config(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-custom-head-") as folder:
            config_path = Path(folder) / "config.json"
            config_path.write_text('{"Server": "invalid"}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not a JSON object"):
                set_custom_html_head.update_config(config_path, "0123456789ab")

    def test_preserves_existing_custom_head_and_replaces_only_managed_loader(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-custom-head-") as folder:
            config_path = Path(folder) / "config.json"
            existing = "console.log('existing head code');"
            config_path.write_text(
                json.dumps({"Server": {"customHTMLHead": existing}}),
                encoding="utf-8",
            )

            self.assertTrue(set_custom_html_head.update_config(config_path, "0123456789ab"))
            first = json.loads(config_path.read_text(encoding="utf-8"))["Server"]["customHTMLHead"]
            self.assertTrue(first.startswith(existing))
            self.assertEqual(first.count(set_custom_html_head.LOADER_START), 1)
            self.assertTrue(set_custom_html_head.update_config(config_path, "abcdef012345"))
            second = json.loads(config_path.read_text(encoding="utf-8"))["Server"]["customHTMLHead"]
            self.assertTrue(second.startswith(existing))
            self.assertEqual(second.count(set_custom_html_head.LOADER_START), 1)
            self.assertIn("pg2-curation-script.js?v=abcdef012345", second)

    def test_migrates_the_legacy_generated_loader_without_duplication(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-custom-head-") as folder:
            config_path = Path(folder) / "config.json"
            config_path.write_text(
                json.dumps({
                    "Server": {
                        "customHTMLHead": set_custom_html_head.legacy_custom_html_head("0123456789ab")
                    }
                }),
                encoding="utf-8",
            )

            self.assertTrue(set_custom_html_head.update_config(config_path, "abcdef012345"))
            updated = json.loads(config_path.read_text(encoding="utf-8"))["Server"]["customHTMLHead"]
            self.assertNotIn("custom-scripts.js", updated)
            self.assertEqual(updated.count(set_custom_html_head.LOADER_START), 1)

    def test_rejects_an_incomplete_managed_loader_block(self) -> None:
        with self.assertRaisesRegex(ValueError, "incomplete"):
            set_custom_html_head.merge_custom_html_head(
                f"console.log('keep');\n{set_custom_html_head.LOADER_START}",
                set_custom_html_head.custom_html_head("0123456789ab"),
            )


if __name__ == "__main__":
    unittest.main()
