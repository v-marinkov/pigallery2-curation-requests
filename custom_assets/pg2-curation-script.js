(() => {
  'use strict';

  const EXTENSION_ID = 'pigallery2-curation-requests';
  const TAG_PREFIX = 'pg-curation:';
  const TAG_DELETE_PENDING = 'pg-curation:delete-pending';
  const TAG_DELETE_APPROVED = 'pg-curation:delete-approved';
  const TAG_DELETE_ERROR = 'pg-curation:delete-error';
  const TAG_METADATA_PENDING = 'pg-curation:metadata-pending';
  const TAG_METADATA_APPROVED = 'pg-curation:metadata-approved';
  const TAG_CATEGORY_PREFIX = 'pg-curation:category:';
  const TAG_REQUESTED_BY_PREFIX = 'pg-curation:requested-by:';
  const TAG_DELETE_REQUESTED_BY_PREFIX = 'pg-curation:delete-requested-by:';
  const TAG_ITEM_PREFIX = 'pg-curation:item:';
  const MODE_STORAGE_PREFIX = 'pg2-curation-mode:';
  const METADATA_FIELD_IDS = [
    'faces', 'tags', 'location', 'dateTime', 'titleCaption', 'duplicate', 'other'
  ];
  const ACTION_TITLES = [
    'Request curation',
    'Cancel my curation requests',
    'Approve all metadata requests (admin only)',
    'Mark all metadata requests done (admin only)',
    'Decline all metadata requests (admin only)',
    'Approve deletion (admin only)',
    'Decline deletion (admin only)'
  ];
  const CATEGORY_LABELS = {
    deletion: 'Deletion',
    faces: 'Wrong or missing faces',
    tags: 'Wrong or missing tags',
    location: 'Wrong or missing location',
    'date-time': 'Wrong date or time',
    'title-caption': 'Wrong or missing title/caption',
    duplicate: 'Duplicate photo',
    other: 'Other'
  };

  const root = document.documentElement;
  const injectedUser = globalThis.ServerInject?.user;
  let currentUserId = String(injectedUser?.id ?? 'anonymous');
  let currentUsername = String(injectedUser?.name ?? '').trim();

  root.dataset.pgCurationPermissionsLoaded = 'false';
  root.dataset.pgCanRequestCuration = 'false';
  root.dataset.pgCanModerateCuration = 'false';
  root.dataset.pgCurationMode = 'disabled';

  const actionSelectorsFor = prefix => ACTION_TITLES
    .map(title => `${prefix} button[title="${title}"]`)
    .join(',\n');
  const stateRules = `
    ${actionSelectorsFor('html[data-pg-curation-mode="disabled"]')},
    html[data-pg-curation-mode="disabled"] .pg-curation-details-button,
    ${actionSelectorsFor('html:not([data-pg-curation-permissions-loaded="true"])')},
    html:not([data-pg-curation-permissions-loaded="true"]) .pg-curation-details-button {
      display: none !important;
    }

    html[data-pg-can-request-curation="false"] button[title="Request curation"] {
      display: none !important;
    }

    /* PiGallery2 currently repeats boolean labels as a heading and beside the
       checkbox. Hide only this extension's redundant headings. */
    .modal-body label.form-label[for="custom_deletion"],
    .modal-body label.form-label[for="custom_faces"],
    .modal-body label.form-label[for="custom_tags"],
    .modal-body label.form-label[for="custom_location"],
    .modal-body label.form-label[for="custom_dateTime"],
    .modal-body label.form-label[for="custom_titleCaption"],
    .modal-body label.form-label[for="custom_duplicate"],
    .modal-body label.form-label[for="custom_other"],
    .modal-body label.form-label[for="custom_confirm"] {
      display: none !important;
    }

    .pg-curation-metadata-option {
      margin-bottom: 0 !important;
      padding: .3rem .9rem;
      border-right: 1px solid rgba(108, 117, 125, .45);
      border-left: .35rem solid var(--bs-secondary, #6c757d);
      background: rgba(108, 117, 125, .09);
    }

    .pg-curation-metadata-first {
      padding-top: .8rem;
      border-top: 1px solid rgba(108, 117, 125, .45);
      border-radius: .4rem .4rem 0 0;
    }

    .pg-curation-metadata-last {
      margin-bottom: 1.5rem !important;
      padding-bottom: .8rem;
      border-bottom: 1px solid rgba(108, 117, 125, .45);
      border-radius: 0 0 .4rem .4rem;
    }

    .pg-curation-deletion-option {
      margin-bottom: 1.5rem !important;
      padding: .8rem .9rem;
      border: 1px solid var(--bs-danger, #dc3545);
      border-left-width: .35rem;
      border-radius: .4rem;
      background: rgba(220, 53, 69, .08);
    }

    .pg-curation-deletion-option .form-check-label,
    .pg-curation-deletion-warning {
      color: var(--bs-danger, #dc3545);
    }

    .pg-curation-deletion-option .form-check-label { font-weight: 600; }
    .pg-curation-deletion-warning { display: block; margin-top: .35rem; }
    .pg-curation-disabled-option { opacity: .5; }

    html[data-pg-can-moderate-curation="false"] button[title="Approve all metadata requests (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Mark all metadata requests done (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Decline all metadata requests (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Approve deletion (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    ${actionSelectorsFor('.photo-container:not(.pg-curation-classified)')},
    .photo-container:not(.pg-curation-classified) .pg-curation-details-button,
    .photo-container:not(.pg-curation-requested-by-me) button[title="Cancel my curation requests"],
    .photo-container:not(.pg-curation-has-metadata) button[title="Approve all metadata requests (admin only)"],
    .photo-container:not(.pg-curation-has-metadata) button[title="Mark all metadata requests done (admin only)"],
    .photo-container:not(.pg-curation-has-metadata) button[title="Decline all metadata requests (admin only)"],
    .photo-container:not(.pg-curation-metadata-pending) button[title="Approve all metadata requests (admin only)"],
    .photo-container.pg-curation-metadata-pending button[title="Mark all metadata requests done (admin only)"],
    .photo-container:not(.pg-curation-metadata-approved) button[title="Mark all metadata requests done (admin only)"],
    .photo-container:not(.pg-curation-delete-pending) button[title="Approve deletion (admin only)"],
    .photo-container:not(.pg-curation-has-deletion) button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    /* Ownership is category-specific: another user's deletion request must not
       hide the current user's pencil. */
    .photo-container.pg-curation-delete-requested-by-me button[title="Request curation"] {
      display: none !important;
    }

    /* Approval locks the whole photo against new requests, regardless of who
       requested or approved the deletion. */
    .photo-container.pg-curation-delete-approved button[title="Request curation"] {
      display: none !important;
    }

    .photo-container button[title="Approve deletion (admin only)"] {
      color: #fff !important;
      border-color: var(--bs-danger, #dc3545) !important;
      background: var(--bs-danger, #dc3545) !important;
    }

    .photo-container button[title="Approve deletion (admin only)"]:hover,
    .photo-container button[title="Approve deletion (admin only)"]:focus-visible {
      background: #bb2d3b !important;
    }

    /* When both workflows coexist, colored outlines distinguish the two
       moderation pairs without changing their independent behavior. */
    .photo-container button[title="Approve all metadata requests (admin only)"],
    .photo-container button[title="Decline all metadata requests (admin only)"] {
      outline: 2px solid rgba(13, 110, 253, .9);
      outline-offset: 1px;
    }

    .photo-container button[title="Approve all metadata requests (admin only)"] {
      color: #fff !important;
      border-color: var(--bs-primary, #0d6efd) !important;
      background: var(--bs-primary, #0d6efd) !important;
    }

    .photo-container button[title="Mark all metadata requests done (admin only)"] {
      color: #fff !important;
      border-color: var(--bs-success, #198754) !important;
      background: var(--bs-success, #198754) !important;
      outline: 2px solid rgba(25, 135, 84, .95);
      outline-offset: 1px;
    }

    .photo-container button[title="Approve all metadata requests (admin only)"]:hover,
    .photo-container button[title="Approve all metadata requests (admin only)"]:focus-visible {
      background: #0b5ed7 !important;
    }

    .photo-container button[title="Mark all metadata requests done (admin only)"]:hover,
    .photo-container button[title="Mark all metadata requests done (admin only)"]:focus-visible {
      background: #157347 !important;
    }

    .photo-container button[title="Approve deletion (admin only)"],
    .photo-container button[title="Decline deletion (admin only)"] {
      outline: 2px solid rgba(220, 53, 69, .95);
      outline-offset: 1px;
    }

    .photo-container.pg-curation-delete-approved button[title="Approve all metadata requests (admin only)"],
    .photo-container.pg-curation-delete-approved button[title="Mark all metadata requests done (admin only)"],
    .photo-container.pg-curation-delete-approved button[title="Decline all metadata requests (admin only)"] {
      display: none !important;
    }

    /* These actions remain registered so PiGallery2 exposes their authenticated
       media routes, but their only UI is the clearly labelled batch panel in
       the request-details dialog. */
    button[title="Cancel my curation requests"],
    button[title="Approve all metadata requests (admin only)"],
    button[title="Mark all metadata requests done (admin only)"],
    button[title="Decline all metadata requests (admin only)"],
    button[title="Approve deletion (admin only)"],
    button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    html[data-pg-can-moderate-curation="false"] .photo-container:not(.pg-curation-requested-by-me)
      .pg-curation-details-button {
      display: none !important;
    }

    .pg-curation-details-button {
      position: absolute;
      z-index: 6;
      right: .35rem;
      top: .35rem;
      border: 0;
      border-radius: 50%;
      width: 2rem;
      height: 2rem;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      background: rgba(25, 25, 25, .78);
      box-shadow: 0 .12rem .3rem rgba(0, 0, 0, .28);
      font-size: 1.05rem;
      line-height: 1;
      cursor: pointer;
      transform: scale(1);
      transform-origin: center;
      transition: transform .15s ease, background-color .15s ease, box-shadow .15s ease;
    }

    .pg-curation-details-button:hover,
    .pg-curation-details-button:focus-visible {
      background: rgba(25, 25, 25, .95);
      box-shadow: 0 .25rem .55rem rgba(0, 0, 0, .38);
      transform: scale(1.14);
    }

    .pg-curation-details-button:focus-visible {
      outline: 2px solid var(--bs-primary, #0d6efd);
      outline-offset: 2px;
    }

    #pg-curation-details-dialog {
      max-width: min(44rem, calc(100vw - 2rem));
      max-height: calc(100vh - 2rem);
      border: 0;
      border-radius: .5rem;
      padding: 0;
      color: inherit;
      background: var(--bs-body-bg, #fff);
      box-shadow: 0 .5rem 2rem rgba(0, 0, 0, .35);
    }

    #pg-curation-details-dialog::backdrop {
      background: rgba(0, 0, 0, .55);
    }

    .pg-curation-dialog-content { padding: 1rem 1.25rem; }
    .pg-curation-dialog-header { display: flex; align-items: center; gap: 1rem; }
    .pg-curation-dialog-header h2 { flex: 1; margin: 0; font-size: 1.25rem; }
    .pg-curation-dialog-close { flex: 0 0 auto; }
    .pg-curation-request-detail { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(128,128,128,.35); }
    .pg-curation-request-detail p { margin: .35rem 0 0; white-space: pre-wrap; }
    .pg-curation-request-detail-header { display: flex; align-items: center; gap: .75rem; }
    .pg-curation-request-detail-header strong { flex: 1; }
    .pg-curation-request-actions { display: inline-flex; gap: .4rem; }
    .pg-curation-request-action-status { font-size: .875rem; margin-top: .4rem; }
    .pg-curation-request-action-status.text-danger { color: var(--bs-danger, #dc3545); }
    .pg-curation-batch-panel {
      margin-top: 1rem;
      padding: .85rem;
      border: 1px solid rgba(108, 117, 125, .4);
      border-radius: .45rem;
      background: rgba(108, 117, 125, .08);
    }
    .pg-curation-batch-panel h3 { margin: 0 0 .65rem; font-size: 1rem; }
    .pg-curation-batch-row { display: flex; align-items: center; gap: .75rem; margin-top: .55rem; }
    .pg-curation-batch-row:first-of-type { margin-top: 0; }
    .pg-curation-batch-row > span { flex: 1; font-weight: 600; }
    .pg-curation-batch-actions { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem; }
    .pg-curation-own-actions {
      margin-top: .75rem;
      padding: .65rem .85rem;
      border-left: .3rem solid var(--bs-secondary, #6c757d);
      border-radius: .3rem;
      background: rgba(108, 117, 125, .06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
    }
    .pg-curation-own-actions span { font-weight: 600; }
    .pg-curation-individual-heading { margin: 1.25rem 0 0; font-size: 1rem; }
  `;

  document.getElementById('pg2-curation-button-permissions')?.remove();
  const style = document.createElement('style');
  style.id = 'pg2-curation-button-permissions';
  style.textContent = stateRules;
  document.head.appendChild(style);

  const modeStorageKey = () => `${MODE_STORAGE_PREFIX}${currentUserId}`;

  const readStoredMode = () => {
    try {
      return localStorage.getItem(modeStorageKey()) === 'enabled';
    } catch {
      return false;
    }
  };

  const setCurationMode = enabled => {
    root.dataset.pgCurationMode = enabled ? 'enabled' : 'disabled';
    try {
      localStorage.setItem(modeStorageKey(), enabled ? 'enabled' : 'disabled');
    } catch {
      // Storage is a convenience only; the current-page mode still works.
    }
    updateModeToggle();
  };

  root.dataset.pgCurationMode = readStoredMode() ? 'enabled' : 'disabled';

  const enhanceRequestPopup = () => {
    const deletionInput = document.getElementById('custom_deletion');
    const deletionOption = deletionInput?.closest('.mb-3');
    if (!deletionInput || !deletionOption) {
      return;
    }

    deletionOption.classList.add('pg-curation-deletion-option');
    const metadataInputs = METADATA_FIELD_IDS
      .map(fieldId => document.getElementById(`custom_${fieldId}`))
      .filter(Boolean);
    metadataInputs.forEach((input, index) => {
      const option = input.closest('.mb-3');
      option?.classList.add('pg-curation-metadata-option');
      option?.classList.toggle('pg-curation-metadata-first', index === 0);
      option?.classList.toggle('pg-curation-metadata-last', index === metadataInputs.length - 1);
    });
    if (!deletionOption.querySelector('.pg-curation-deletion-warning')) {
      const warning = document.createElement('small');
      warning.id = 'pg-curation-deletion-warning';
      warning.className = 'pg-curation-deletion-warning';
      warning.textContent = 'Selecting deletion clears and disables all metadata corrections above.';
      deletionOption.appendChild(warning);
      deletionInput.setAttribute('aria-describedby', warning.id);
    }

    const modal = deletionInput.closest('.modal');
    if (modal && modal.dataset.pgCurationBackdropBound !== 'true') {
      modal.dataset.pgCurationBackdropBound = 'true';
      modal.addEventListener('click', event => {
        if (event.target === modal) {
          modal.querySelector('.modal-header .btn-close')?.click();
        }
      });
    }

    const synchronizeExclusiveChoice = () => {
      const deletionSelected = deletionInput.checked;
      const metadataInputs = METADATA_FIELD_IDS
        .map(fieldId => document.getElementById(`custom_${fieldId}`))
        .filter(Boolean);
      for (const input of metadataInputs) {
        if (deletionSelected && input.checked) {
          // A real click keeps PiGallery2's Angular form model synchronized.
          input.click();
        }
        input.disabled = deletionSelected;
        input.closest('.mb-3')?.classList.toggle(
          'pg-curation-disabled-option', deletionSelected
        );
      }
    };

    if (deletionInput.dataset.pgCurationExclusiveBound !== 'true') {
      deletionInput.dataset.pgCurationExclusiveBound = 'true';
      deletionInput.addEventListener('change', synchronizeExclusiveChoice);
    }
    synchronizeExclusiveChoice();
  };

  const requesterTagFor = (prefix, username) => {
    const safeName = username
      .replace(/,/g, '‚')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 100);
    return safeName ? `${prefix}${safeName}` : '';
  };

  const escapeRegularExpression = value =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const containsRenderedKeyword = (renderedText, keyword) => {
    if (!keyword) {
      return false;
    }
    return new RegExp(
      `(?:^|[#\\s,])${escapeRegularExpression(keyword)}(?=$|[#\\s,])`,
      'iu'
    ).test(renderedText);
  };

  const itemTokenFrom = keywordText => {
    const expression = new RegExp(`${escapeRegularExpression(TAG_ITEM_PREFIX)}([a-f0-9]{32})`, 'iu');
    return keywordText.match(expression)?.[1]?.toLowerCase() || '';
  };

  const ensureDetailsButton = photoContainer => {
    const token = photoContainer.dataset.pgCurationItemToken || '';
    let button = photoContainer.querySelector('.pg-curation-details-button');
    if (!token) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'pg-curation-details-button';
      button.title = 'View curation request details';
      button.setAttribute('aria-label', 'View curation request details');
      button.textContent = 'ⓘ';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void showRequestDetails(photoContainer.dataset.pgCurationItemToken || '');
      });
      photoContainer.appendChild(button);
    }
  };

  const classifyPhoto = photoContainer => {
    const keywordText = photoContainer.querySelector('.photo-keywords')?.textContent ?? '';
    const token = itemTokenFrom(keywordText);
    const hasMetadata = keywordText.includes(TAG_CATEGORY_PREFIX);
    const metadataPending = keywordText.includes(TAG_METADATA_PENDING);
    const metadataApproved = keywordText.includes(TAG_METADATA_APPROVED);
    const deletionPending = keywordText.includes(TAG_DELETE_PENDING);
    const deletionApproved = keywordText.includes(TAG_DELETE_APPROVED);
    const deletionError = keywordText.includes(TAG_DELETE_ERROR);

    photoContainer.dataset.pgCurationItemToken = token;
    photoContainer.classList.toggle('pg-curation-present', keywordText.includes(TAG_PREFIX));
    photoContainer.classList.toggle('pg-curation-has-metadata', hasMetadata);
    photoContainer.classList.toggle('pg-curation-metadata-pending', metadataPending);
    photoContainer.classList.toggle('pg-curation-metadata-approved', metadataApproved);
    photoContainer.classList.toggle('pg-curation-delete-pending', deletionPending);
    photoContainer.classList.toggle('pg-curation-delete-approved', deletionApproved);
    photoContainer.classList.toggle(
      'pg-curation-has-deletion',
      deletionPending || deletionApproved || deletionError
    );
    photoContainer.classList.toggle(
      'pg-curation-requested-by-me',
      containsRenderedKeyword(
        keywordText, requesterTagFor(TAG_REQUESTED_BY_PREFIX, currentUsername)
      )
    );
    photoContainer.classList.toggle(
      'pg-curation-delete-requested-by-me',
      containsRenderedKeyword(
        keywordText, requesterTagFor(TAG_DELETE_REQUESTED_BY_PREFIX, currentUsername)
      )
    );
    photoContainer.classList.add('pg-curation-classified');
    ensureDetailsButton(photoContainer);
  };

  const classifyAllPhotos = () => {
    document.querySelectorAll('.photo-container').forEach(classifyPhoto);
  };

  const extensionBasePath = () => {
    const uiConfig = globalThis.ServerInject?.UIExtensionConfigs?.find(config =>
      config?.mediaButtons?.some(button => button?.apiPath === 'request-curation')
    );
    return String(uiConfig?.extensionBasePath ?? `/extension/${EXTENSION_ID}`);
  };

  const apiBase = () => String(
    globalThis.ServerInject?.ConfigInject?.Server?.apiPath ?? '/pgapi'
  ).replace(/\/$/, '');

  const extensionEndpoint = path => `${apiBase()}${extensionBasePath()}/${path}`;

  const unwrapResponse = async response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const envelope = await response.json();
    if (envelope?.error) {
      throw new Error(envelope.error.message || 'request failed');
    }
    return envelope?.result ?? envelope;
  };

  const loadPermissions = async () => {
    if (Number(injectedUser?.role ?? 0) < 3) {
      return;
    }
    try {
      const permissions = await unwrapResponse(await fetch(
        extensionEndpoint('client-permissions'),
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {Accept: 'application/json'}
        }
      ));
      if (
        typeof permissions?.userId !== 'string' ||
        typeof permissions?.userName !== 'string' ||
        typeof permissions?.canRequestCuration !== 'boolean' ||
        typeof permissions?.canModerateCuration !== 'boolean'
      ) {
        throw new Error('invalid permission response');
      }
      const previousStorageKey = modeStorageKey();
      currentUserId = permissions.userId;
      currentUsername = permissions.userName.trim();
      if (previousStorageKey !== modeStorageKey()) {
        root.dataset.pgCurationMode = readStoredMode() ? 'enabled' : 'disabled';
      }
      root.dataset.pgUser = currentUsername;
      root.dataset.pgCanRequestCuration = String(permissions.canRequestCuration);
      root.dataset.pgCanModerateCuration = String(permissions.canModerateCuration);
      root.dataset.pgCurationPermissionsLoaded = 'true';
      scheduleRefresh();
    } catch (error) {
      console.error(
        `[${EXTENSION_ID}] Could not load permissions; curation actions remain hidden.`,
        error
      );
    }
  };

  const updateModeToggle = () => {
    const modeSwitch = document.getElementById('pg-curation-mode-switch');
    if (!modeSwitch) {
      return;
    }
    const enabled = root.dataset.pgCurationMode === 'enabled';
    modeSwitch.checked = enabled;
    modeSwitch.setAttribute('aria-checked', String(enabled));
  };

  const ensureMyRequestsMenuItem = modeItem => {
    if (!modeItem || document.getElementById('pg-curation-my-requests')) {
      return;
    }
    const item = document.createElement('li');
    item.id = 'pg-curation-my-requests';
    item.setAttribute('role', 'menuitem');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dropdown-item';
    const icon = document.createElement('span');
    icon.className = 'me-2';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✎';
    const label = document.createElement('span');
    label.textContent = 'My curation requests';
    button.append(icon, label);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const requesterKeyword = requesterTagFor(TAG_REQUESTED_BY_PREFIX, currentUsername);
      if (!requesterKeyword) {
        return;
      }
      // PiGallery2 3.5.x SearchQueryUtils.urlify format:
      // t=keyword(104), v=value, mt=exact_match(1).
      const query = JSON.stringify({t: 104, v: requesterKeyword, mt: 1});
      const target = new URL(`search/${encodeURIComponent(query)}`, document.baseURI);
      globalThis.location.assign(target.href);
    });
    item.appendChild(button);
    modeItem.parentNode?.insertBefore(item, modeItem.nextSibling);
  };

  const ensureModeToggle = () => {
    if (Number(globalThis.ServerInject?.user?.role ?? 0) < 3) {
      return;
    }
    const existingItem = document.getElementById('pg-curation-mode-toggle');
    if (existingItem) {
      updateModeToggle();
      ensureMyRequestsMenuItem(existingItem);
      return;
    }

    // PiGallery2 renders the Tools submenu lazily. Anchor to controls inside that
    // submenu instead of the outer hamburger menu, which can have several open
    // dropdowns in the DOM at the same time.
    const anchorControl = document.getElementById('fix-switch') ||
      document.getElementById('autopoll-interval-select');
    const anchorItem = anchorControl?.closest('li[role="menuitem"]') ||
      anchorControl?.closest('li');
    const menu = anchorItem?.closest('ul.dropdown-menu');
    if (!anchorItem || !menu) {
      return;
    }

    const item = document.createElement('li');
    item.id = 'pg-curation-mode-toggle';
    item.setAttribute('role', 'menuitem');

    const row = document.createElement('div');
    row.className = 'dropdown-item d-flex justify-content-between';

    const label = document.createElement('span');
    label.textContent = 'Curation mode';
    label.title = 'Show or hide photo curation controls';

    const switchContainer = document.createElement('div');
    switchContainer.className = 'form-check form-switch';

    const modeSwitch = document.createElement('input');
    modeSwitch.id = 'pg-curation-mode-switch';
    modeSwitch.name = 'curation-mode';
    modeSwitch.type = 'checkbox';
    modeSwitch.className = 'form-check-input';
    modeSwitch.setAttribute('role', 'switch');
    modeSwitch.addEventListener('click', event => {
      event.stopPropagation();
    });
    modeSwitch.addEventListener('change', event => {
      event.stopPropagation();
      setCurationMode(modeSwitch.checked);
    });

    row.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setCurationMode(root.dataset.pgCurationMode !== 'enabled');
    });

    switchContainer.appendChild(modeSwitch);
    row.append(label, switchContainer);
    item.appendChild(row);
    menu.insertBefore(item, anchorItem);
    ensureMyRequestsMenuItem(item);
    updateModeToggle();
  };

  const ensureDetailsDialog = () => {
    let dialog = document.getElementById('pg-curation-details-dialog');
    if (dialog) {
      return dialog;
    }
    dialog = document.createElement('dialog');
    dialog.id = 'pg-curation-details-dialog';
    const content = document.createElement('div');
    content.className = 'pg-curation-dialog-content';
    const header = document.createElement('div');
    header.className = 'pg-curation-dialog-header';
    const heading = document.createElement('h2');
    heading.textContent = 'Curation requests';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close pg-curation-dialog-close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => dialog.close());
    const body = document.createElement('div');
    body.className = 'pg-curation-dialog-body';
    header.append(heading, close);
    content.append(header, body);
    dialog.appendChild(content);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
    document.body.appendChild(dialog);
    return dialog;
  };

  const reviewMetadataRequest = async (request, mediaPath, outcome, section) => {
    const verb = outcome === 'APPROVED' ? 'Approve' : outcome === 'RESOLVED' ? 'Mark done' : 'Decline';
    const label = CATEGORY_LABELS[request.category] || String(request.category);
    const question = outcome === 'RESOLVED'
      ? `Mark the ${label} request from ${request.requesterName} as done?`
      : `${verb} the ${label} request from ${request.requesterName}?`;
    if (!globalThis.confirm(question)) {
      return;
    }
    const buttons = section.querySelectorAll('.pg-curation-request-actions button');
    buttons.forEach(button => { button.disabled = true; });
    let status = section.querySelector('.pg-curation-request-action-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'pg-curation-request-action-status';
      section.appendChild(status);
    }
    status.classList.remove('text-danger');
    status.textContent = `${verb} in progress…`;
    try {
      await unwrapResponse(await fetch(
        extensionEndpoint('review-metadata-request'),
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({
            media: mediaPath,
            data: {customFields: {requestId: request.requestId, outcome}}
          })
        }
      ));
      status.textContent = `${outcome === 'RESOLVED' ? 'Marked done' : `${verb}d`}. Refreshing…`;
      globalThis.location.reload();
    } catch (error) {
      console.error(`[${EXTENSION_ID}] Could not review metadata request.`, error);
      status.classList.add('text-danger');
      status.textContent = `${verb} failed: ${error.message || error}`;
      buttons.forEach(button => { button.disabled = false; });
    }
  };

  const reviewDeletionRequest = async (request, mediaPath, outcome, section) => {
    const approving = outcome === 'APPROVED';
    const verb = approving ? 'Approve' : 'Decline';
    const consequence = approving
      ? 'This approves the photo for the host-side deletion queue for every requester.'
      : 'This declines the photo-level deletion workflow for every requester.';
    if (!globalThis.confirm(`${verb} deletion requested by ${request.requesterName}?\n\n${consequence}`)) {
      return;
    }
    const buttons = section.querySelectorAll('.pg-curation-request-actions button');
    buttons.forEach(button => { button.disabled = true; });
    let status = section.querySelector('.pg-curation-request-action-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'pg-curation-request-action-status';
      section.appendChild(status);
    }
    status.classList.remove('text-danger');
    status.textContent = `${verb} in progress…`;
    try {
      await unwrapResponse(await fetch(
        extensionEndpoint(approving ? 'approve-deletion' : 'decline-deletion'),
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({
            media: mediaPath,
            data: {customFields: {confirm: true}}
          })
        }
      ));
      status.textContent = `${verb}d. Refreshing…`;
      globalThis.location.reload();
    } catch (error) {
      console.error(`[${EXTENSION_ID}] Could not review deletion request.`, error);
      status.classList.add('text-danger');
      status.textContent = `${verb} failed: ${error.message || error}`;
      buttons.forEach(button => { button.disabled = false; });
    }
  };

  const cancelOwnRequest = async (request, mediaPath, section) => {
    const label = CATEGORY_LABELS[request.category] || String(request.category);
    if (!globalThis.confirm(`Cancel your ${label} request?\n\nOther users' requests are not affected.`)) {
      return;
    }
    const buttons = section.querySelectorAll('.pg-curation-request-actions button');
    buttons.forEach(button => { button.disabled = true; });
    let status = section.querySelector('.pg-curation-request-action-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'pg-curation-request-action-status';
      section.appendChild(status);
    }
    status.classList.remove('text-danger');
    status.textContent = 'Cancellation in progress…';
    try {
      await unwrapResponse(await fetch(
        extensionEndpoint('cancel-own-request'),
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({
            media: mediaPath,
            data: {customFields: {requestId: request.requestId, kind: request.kind}}
          })
        }
      ));
      status.textContent = 'Cancelled. Refreshing…';
      globalThis.location.reload();
    } catch (error) {
      console.error(`[${EXTENSION_ID}] Could not cancel owned curation request.`, error);
      status.classList.add('text-danger');
      status.textContent = `Cancellation failed: ${error.message || error}`;
      buttons.forEach(button => { button.disabled = false; });
    }
  };

  const runBatchAction = async ({
    endpoint, mediaPath, controlRoot, confirmation, successMessage,
    resolutionPrompt
  }) => {
    if (!globalThis.confirm(confirmation)) {
      return;
    }
    let resolutionComment;
    if (resolutionPrompt) {
      resolutionComment = globalThis.prompt(resolutionPrompt, '');
      if (resolutionComment === null) {
        return;
      }
    }
    const buttons = controlRoot.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    let status = controlRoot.querySelector('.pg-curation-request-action-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'pg-curation-request-action-status';
      controlRoot.appendChild(status);
    }
    status.classList.remove('text-danger');
    status.textContent = 'Action in progress…';
    try {
      const customFields = {confirm: true};
      if (resolutionComment !== undefined) {
        customFields.resolutionComment = resolutionComment;
      }
      await unwrapResponse(await fetch(
        extensionEndpoint(endpoint),
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({media: mediaPath, data: {customFields}})
        }
      ));
      status.textContent = `${successMessage} Refreshing…`;
      globalThis.location.reload();
    } catch (error) {
      console.error(`[${EXTENSION_ID}] Batch curation action failed.`, error);
      status.classList.add('text-danger');
      status.textContent = `Action failed: ${error.message || error}`;
      buttons.forEach(button => { button.disabled = false; });
    }
  };

  const makeBatchButton = (label, className, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', () => { void action(); });
    return button;
  };

  const renderBatchControls = (body, requests, reviewContext) => {
    const mediaPath = typeof reviewContext.media === 'string' ? reviewContext.media : '';
    if (!mediaPath) {
      return;
    }
    const ownsActiveRequest = requests.some(request => request.ownRequest === true);
    if (ownsActiveRequest) {
      const ownPanel = document.createElement('section');
      ownPanel.className = 'pg-curation-own-actions';
      const label = document.createElement('span');
      label.textContent = 'Your requests on this photo';
      const cancel = makeBatchButton(
        'Cancel my requests',
        'btn btn-sm btn-outline-secondary',
        () => runBatchAction({
          endpoint: 'cancel-own-curation-requests',
          mediaPath,
          controlRoot: ownPanel,
          confirmation: "Cancel all of your active requests for this photo?\n\nOther users' requests are not affected.",
          successMessage: 'Your requests were cancelled.'
        })
      );
      ownPanel.append(label, cancel);
      body.appendChild(ownPanel);
    }

    if (reviewContext.canModerate !== true) {
      return;
    }
    const metadataPending = requests.some(
      request => request.kind === 'metadata' && request.state === 'OPEN'
    );
    const metadataApproved = requests.some(
      request => request.kind === 'metadata' && request.state === 'APPROVED'
    );
    const deletionState = requests.find(request => request.kind === 'deletion')?.state;
    const deletionApproved = deletionState === 'APPROVED';
    const showMetadataActions = (metadataPending || metadataApproved) && !deletionApproved;
    const showDeletionActions = ['PENDING', 'APPROVED', 'ERROR'].includes(deletionState);
    if (!showMetadataActions && !showDeletionActions) {
      return;
    }

    const panel = document.createElement('section');
    panel.className = 'pg-curation-batch-panel';
    const heading = document.createElement('h3');
    heading.textContent = 'All requests on this photo';
    panel.appendChild(heading);

    if (showMetadataActions) {
      const row = document.createElement('div');
      row.className = 'pg-curation-batch-row';
      const label = document.createElement('span');
      label.textContent = 'Metadata requests';
      const actions = document.createElement('div');
      actions.className = 'pg-curation-batch-actions';
      if (metadataPending) {
        actions.appendChild(makeBatchButton(
          'Approve all',
          'btn btn-sm btn-primary',
          () => runBatchAction({
            endpoint: 'approve-all-metadata-requests', mediaPath, controlRoot: panel,
            confirmation: 'Approve every pending metadata request for this photo?',
            successMessage: 'All pending metadata requests were approved.'
          })
        ));
      } else if (metadataApproved) {
        actions.appendChild(makeBatchButton(
          'Mark all done',
          'btn btn-sm btn-success',
          () => runBatchAction({
            endpoint: 'mark-all-metadata-requests-done', mediaPath, controlRoot: panel,
            confirmation: 'Mark every approved metadata request for this photo as done?',
            resolutionPrompt: 'Optional resolution comment:',
            successMessage: 'All approved metadata requests were marked done.'
          })
        ));
      }
      actions.appendChild(makeBatchButton(
        'Decline all',
        'btn btn-sm btn-outline-danger',
        () => runBatchAction({
          endpoint: 'decline-all-metadata-requests', mediaPath, controlRoot: panel,
          confirmation: 'Decline every pending or approved metadata request for this photo?',
          resolutionPrompt: 'Optional decline comment:',
          successMessage: 'All metadata requests were declined.'
        })
      ));
      row.append(label, actions);
      panel.appendChild(row);
    }

    if (showDeletionActions) {
      const row = document.createElement('div');
      row.className = 'pg-curation-batch-row';
      const label = document.createElement('span');
      label.textContent = 'Deletion requests';
      const actions = document.createElement('div');
      actions.className = 'pg-curation-batch-actions';
      if (deletionState === 'PENDING') {
        actions.appendChild(makeBatchButton(
          'Approve all',
          'btn btn-sm btn-danger',
          () => runBatchAction({
            endpoint: 'approve-deletion', mediaPath, controlRoot: panel,
            confirmation: 'Approve deletion of this photo for every requester?\n\nThis adds it to the host-side deletion queue.',
            successMessage: 'Deletion was approved.'
          })
        ));
      }
      actions.appendChild(makeBatchButton(
        'Decline all',
        'btn btn-sm btn-outline-danger',
        () => runBatchAction({
          endpoint: 'decline-deletion', mediaPath, controlRoot: panel,
          confirmation: 'Decline the photo-level deletion workflow for every requester?',
          successMessage: 'Deletion was declined.'
        })
      ));
      row.append(label, actions);
      panel.appendChild(row);
    }
    body.appendChild(panel);
  };

  const renderRequestDetails = (requests, reviewContext = {}) => {
    const dialog = ensureDetailsDialog();
    const body = dialog.querySelector('.pg-curation-dialog-body');
    body.replaceChildren();
    if (!Array.isArray(requests) || requests.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No request details are available for your account.';
      body.appendChild(empty);
    } else {
      renderBatchControls(body, requests, reviewContext);
      const individualHeading = document.createElement('h3');
      individualHeading.className = 'pg-curation-individual-heading';
      individualHeading.textContent = 'Individual requests';
      body.appendChild(individualHeading);
      const deletionApproved = requests.some(
        request => request.kind === 'deletion' && request.state === 'APPROVED'
      );
      const canReviewMetadata = reviewContext.canModerate === true &&
        typeof reviewContext.media === 'string' && reviewContext.media.length > 0 &&
        !deletionApproved;
      const canReviewDeletion = reviewContext.canModerate === true &&
        typeof reviewContext.media === 'string' && reviewContext.media.length > 0;
      for (const request of requests) {
        const section = document.createElement('section');
        section.className = 'pg-curation-request-detail';
        const header = document.createElement('div');
        header.className = 'pg-curation-request-detail-header';
        const title = document.createElement('strong');
        title.textContent = CATEGORY_LABELS[request.category] || String(request.category);
        header.appendChild(title);
        if (
          canReviewMetadata && request.kind === 'metadata' && ['OPEN', 'APPROVED'].includes(request.state) &&
          Number.isInteger(request.requestId) && request.requestId > 0
        ) {
          const actions = document.createElement('div');
          actions.className = 'pg-curation-request-actions';
          const advance = document.createElement('button');
          advance.type = 'button';
          advance.className = request.state === 'APPROVED'
            ? 'btn btn-sm btn-success'
            : 'btn btn-sm btn-primary';
          advance.textContent = request.state === 'APPROVED' ? 'Mark done' : 'Approve';
          advance.addEventListener('click', () => {
            void reviewMetadataRequest(
              request,
              reviewContext.media,
              request.state === 'APPROVED' ? 'RESOLVED' : 'APPROVED',
              section
            );
          });
          const decline = document.createElement('button');
          decline.type = 'button';
          decline.className = 'btn btn-sm btn-outline-danger';
          decline.textContent = 'Decline';
          decline.addEventListener('click', () => {
            void reviewMetadataRequest(request, reviewContext.media, 'DISMISSED', section);
          });
          actions.append(advance, decline);
          header.appendChild(actions);
        } else if (
          canReviewDeletion && request.kind === 'deletion' &&
          ['PENDING', 'APPROVED', 'ERROR'].includes(request.state)
        ) {
          const actions = document.createElement('div');
          actions.className = 'pg-curation-request-actions';
          if (request.state === 'PENDING') {
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'btn btn-sm btn-danger';
            approve.textContent = 'Approve';
            approve.addEventListener('click', () => {
              void reviewDeletionRequest(request, reviewContext.media, 'APPROVED', section);
            });
            actions.appendChild(approve);
          }
          const decline = document.createElement('button');
          decline.type = 'button';
          decline.className = 'btn btn-sm btn-outline-danger';
          decline.textContent = 'Decline';
          decline.addEventListener('click', () => {
            void reviewDeletionRequest(request, reviewContext.media, 'DECLINED', section);
          });
          actions.appendChild(decline);
          header.appendChild(actions);
        }
        if (
          reviewContext.canModerate !== true && request.ownRequest === true &&
          Number.isInteger(request.requestId) &&
          request.requestId > 0 && typeof reviewContext.media === 'string' &&
          reviewContext.media.length > 0
        ) {
          let actions = header.querySelector('.pg-curation-request-actions');
          if (!actions) {
            actions = document.createElement('div');
            actions.className = 'pg-curation-request-actions';
            header.appendChild(actions);
          }
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn btn-sm btn-outline-secondary';
          cancel.textContent = 'Cancel';
          cancel.addEventListener('click', () => {
            void cancelOwnRequest(request, reviewContext.media, section);
          });
          actions.appendChild(cancel);
        }
        const metadata = document.createElement('div');
        const date = new Date(request.requestedAt);
        metadata.textContent = `${request.requesterName} · ${
          Number.isNaN(date.getTime()) ? request.requestedAt : date.toLocaleString()
        } · ${request.state}`;
        section.append(header, metadata);
        if (request.comment) {
          const comment = document.createElement('p');
          comment.textContent = request.comment;
          section.appendChild(comment);
        }
        body.appendChild(section);
      }
    }
    dialog.showModal();
  };

  const showRequestDetails = async token => {
    if (!/^[a-f0-9]{32}$/i.test(token)) {
      return;
    }
    try {
      const result = await unwrapResponse(await fetch(
        extensionEndpoint(`request-details/${encodeURIComponent(token)}`),
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {Accept: 'application/json'}
        }
      ));
      renderRequestDetails(result?.requests || [], {
        media: result?.media,
        canModerate: result?.canModerate
      });
    } catch (error) {
      console.error(`[${EXTENSION_ID}] Could not load curation request details.`, error);
      renderRequestDetails([]);
    }
  };

  let refreshScheduled = false;
  const scheduleRefresh = () => {
    if (refreshScheduled) {
      return;
    }
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      classifyAllPhotos();
      ensureModeToggle();
      enhanceRequestPopup();
    });
  };

  const startObserver = () => {
    classifyAllPhotos();
    ensureModeToggle();
    enhanceRequestPopup();
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, {childList: true, subtree: true, characterData: true});
    void loadPermissions();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, {once: true});
  } else {
    startObserver();
  }
})();
