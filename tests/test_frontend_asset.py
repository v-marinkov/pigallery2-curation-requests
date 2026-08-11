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

    def test_boolean_popup_headings_are_hidden_without_hiding_comment_label(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        for field_id in (
            "deletion",
            "faces",
            "tags",
            "location",
            "dateTime",
            "titleCaption",
            "duplicate",
            "other",
        ):
            self.assertIn(f'label.form-label[for="custom_{field_id}"]', source)
        self.assertNotIn('label.form-label[for="custom_comment"]', source)

    def test_deletion_is_presented_as_an_exclusive_destructive_choice(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("deletionOption.classList.add('pg-curation-deletion-option')", source)
        self.assertIn("input.disabled = deletionSelected", source)
        self.assertIn("if (deletionSelected && input.checked)", source)
        self.assertIn("input.click()", source)
        self.assertIn(".photo-container.pg-curation-has-deletion", source)
        self.assertIn('button[title="Approve deletion (admin only)"]', source)


if __name__ == "__main__":
    unittest.main()
