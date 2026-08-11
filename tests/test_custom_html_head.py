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
            asset_path = root / "custom-scripts.js"
            config_path.write_text(
                json.dumps({"Server": {"applicationTitle": "Family"}, "Database": {"type": "sqlite"}}),
                encoding="utf-8",
            )
            asset_path.write_text("console.log('curation');\n", encoding="utf-8")

            cache_tag = set_custom_html_head.asset_cache_tag(asset_path)
            self.assertEqual(len(cache_tag), 12)
            settings = (
                "request-deletions",
                "/app/data/curation/curation.sqlite",
                "admin, family-user",
                2000,
            )
            self.assertTrue(set_custom_html_head.update_config(config_path, cache_tag, settings))
            self.assertFalse(set_custom_html_head.update_config(config_path, cache_tag, settings))

            updated = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(updated["Server"]["applicationTitle"], "Family")
            self.assertEqual(updated["Database"], {"type": "sqlite"})
            self.assertIn(f"custom-scripts.js?v={cache_tag}", updated["Server"]["customHTMLHead"])
            self.assertEqual(
                updated["Extensions"]["extensions"]["request-deletions"],
                {
                    "enabled": True,
                    "path": "request-deletions",
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


if __name__ == "__main__":
    unittest.main()
