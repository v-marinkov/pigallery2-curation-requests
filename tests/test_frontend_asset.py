import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ASSET = PROJECT_ROOT / "custom_assets" / "custom-scripts.js"


class FrontendAssetTests(unittest.TestCase):
    def test_curation_mode_targets_the_lazy_tools_submenu(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("document.getElementById('fix-switch')", source)
        self.assertIn("document.getElementById('autopoll-interval-select')", source)
        self.assertIn("anchorItem?.closest('ul.dropdown-menu')", source)
        self.assertIn("menu.insertBefore(item, anchorItem)", source)
        self.assertIn("row.className = 'dropdown-item d-flex justify-content-between'", source)
        self.assertIn("switchContainer.className = 'form-check form-switch'", source)
        self.assertNotIn("document.getElementById('button-frame-menu')", source)


if __name__ == "__main__":
    unittest.main()
