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
        self.assertIn("item.id = 'pg-curation-my-requests'", source)
        self.assertIn("label.textContent = 'My curation requests'", source)
        self.assertIn("JSON.stringify({t: 104, v: requesterKeyword, mt: 1})", source)
        self.assertIn("globalThis.location.assign(target.href)", source)
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
        self.assertIn('label.form-label[for="custom_confirm"]', source)
        self.assertNotIn('label.form-label[for="custom_comment"]', source)

    def test_deletion_is_presented_as_an_exclusive_destructive_choice(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("deletionOption.classList.add('pg-curation-deletion-option')", source)
        self.assertIn("input.disabled = deletionSelected", source)
        self.assertIn("if (deletionSelected && input.checked)", source)
        self.assertIn("input.click()", source)
        self.assertIn("'pg-curation-has-deletion'", source)
        self.assertIn('button[title="Approve deletion (admin only)"]', source)

    def test_request_ownership_and_details_button_are_presented_per_user(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("TAG_DELETE_REQUESTED_BY_PREFIX", source)
        self.assertIn("'pg-curation-delete-requested-by-me'", source)
        self.assertIn(".photo-container.pg-curation-delete-requested-by-me", source)
        self.assertIn("button.textContent = 'ⓘ'", source)
        self.assertIn("top: .35rem", source)
        self.assertIn("border-radius: 50%", source)
        self.assertIn("transform: scale(1.14)", source)

    def test_metadata_options_are_grouped_above_deletion(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("option?.classList.add('pg-curation-metadata-option')", source)
        self.assertIn("'pg-curation-metadata-first'", source)
        self.assertIn("'pg-curation-metadata-last'", source)
        self.assertIn("metadata corrections above", source)

    def test_admin_metadata_and_deletion_controls_can_coexist(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertNotIn(
            '.photo-container.pg-curation-has-deletion button[title="Resolve metadata requests',
            source,
        )
        self.assertIn("outline: 2px solid rgba(13, 110, 253, .9)", source)
        self.assertIn("outline: 2px solid rgba(220, 53, 69, .95)", source)

    def test_admin_can_review_individual_metadata_requests(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("extensionEndpoint('review-metadata-request')", source)
        self.assertIn("request.requestId", source)
        self.assertIn("advance.textContent = request.state === 'APPROVED' ? 'Mark done' : 'Approve'", source)
        self.assertIn("decline.textContent = 'Decline'", source)
        self.assertIn("['OPEN', 'APPROVED'].includes(request.state)", source)
        self.assertIn("!deletionApproved", source)
        self.assertIn(".photo-container.pg-curation-delete-approved", source)

    def test_admin_can_reach_photo_level_deletion_controls_from_deletion_rows(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("const reviewDeletionRequest", source)
        self.assertIn("approving ? 'approve-deletion' : 'decline-deletion'", source)
        self.assertIn("request.kind === 'deletion'", source)
        self.assertIn("['PENDING', 'APPROVED', 'ERROR'].includes(request.state)", source)
        self.assertIn("photo-level deletion workflow for every requester", source)

    def test_owner_can_cancel_one_owned_request(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("const cancelOwnRequest", source)
        self.assertIn("extensionEndpoint('cancel-own-request')", source)
        self.assertIn("request.ownRequest === true", source)
        self.assertIn("reviewContext.canModerate !== true", source)
        self.assertIn("cancel.textContent = 'Cancel'", source)
        self.assertNotIn("cancel.textContent = 'Cancel mine'", source)

    def test_approved_metadata_remains_actionable_until_marked_done(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("['OPEN', 'APPROVED'].includes(request.state)", source)
        self.assertIn("request.state === 'APPROVED' ? 'Mark done' : 'Approve'", source)
        self.assertIn("request.state === 'APPROVED' ? 'RESOLVED' : 'APPROVED'", source)

    def test_details_dialog_uses_the_native_bootstrap_close_button(self):
        source = FRONTEND_ASSET.read_text(encoding="utf-8")

        self.assertIn("close.className = 'btn-close pg-curation-dialog-close'", source)
        self.assertNotIn("close.textContent = '×'", source)


if __name__ == "__main__":
    unittest.main()
