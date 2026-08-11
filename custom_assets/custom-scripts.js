(() => {
  'use strict';

  const EXTENSION_ID = 'pigallery2-curation-requests';
  const TAG_PREFIX = 'pg-curation:';
  const TAG_DELETE_PENDING = 'pg-curation:delete-pending';
  const TAG_DELETE_APPROVED = 'pg-curation:delete-approved';
  const TAG_DELETE_ERROR = 'pg-curation:delete-error';
  const TAG_CATEGORY_PREFIX = 'pg-curation:category:';
  const TAG_REQUESTED_BY_PREFIX = 'pg-curation:requested-by:';
  const TAG_ITEM_PREFIX = 'pg-curation:item:';
  const MODE_STORAGE_PREFIX = 'pg2-curation-mode:';
  const ACTION_TITLES = [
    'Request curation',
    'Cancel my curation requests',
    'Resolve metadata requests (admin only)',
    'Dismiss metadata requests (admin only)',
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

    html[data-pg-can-moderate-curation="false"] button[title="Resolve metadata requests (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Dismiss metadata requests (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Approve deletion (admin only)"],
    html[data-pg-can-moderate-curation="false"] button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    ${actionSelectorsFor('.photo-container:not(.pg-curation-classified)')},
    .photo-container:not(.pg-curation-classified) .pg-curation-details-button,
    .photo-container:not(.pg-curation-requested-by-me) button[title="Cancel my curation requests"],
    .photo-container:not(.pg-curation-has-metadata) button[title="Resolve metadata requests (admin only)"],
    .photo-container:not(.pg-curation-has-metadata) button[title="Dismiss metadata requests (admin only)"],
    .photo-container:not(.pg-curation-delete-pending) button[title="Approve deletion (admin only)"],
    .photo-container:not(.pg-curation-has-deletion) button[title="Decline deletion (admin only)"] {
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
      bottom: .35rem;
      border: 0;
      border-radius: 999px;
      padding: .2rem .45rem;
      color: #fff;
      background: rgba(25, 25, 25, .78);
      font-size: .85rem;
      line-height: 1.25;
      cursor: pointer;
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
    .pg-curation-dialog-close { border: 0; background: transparent; font-size: 1.5rem; }
    .pg-curation-request-detail { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(128,128,128,.35); }
    .pg-curation-request-detail p { margin: .35rem 0 0; white-space: pre-wrap; }
    .pg-curation-mode-indicator { display: inline-block; width: 1.25rem; }
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

  const requesterTagFor = username => {
    const safeName = username
      .replace(/,/g, '‚')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 100);
    return safeName ? `${TAG_REQUESTED_BY_PREFIX}${safeName}` : '';
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
      button.textContent = '💬';
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
    const deletionPending = keywordText.includes(TAG_DELETE_PENDING);
    const deletionApproved = keywordText.includes(TAG_DELETE_APPROVED);
    const deletionError = keywordText.includes(TAG_DELETE_ERROR);

    photoContainer.dataset.pgCurationItemToken = token;
    photoContainer.classList.toggle('pg-curation-present', keywordText.includes(TAG_PREFIX));
    photoContainer.classList.toggle('pg-curation-has-metadata', hasMetadata);
    photoContainer.classList.toggle('pg-curation-delete-pending', deletionPending);
    photoContainer.classList.toggle(
      'pg-curation-has-deletion',
      deletionPending || deletionApproved || deletionError
    );
    photoContainer.classList.toggle(
      'pg-curation-requested-by-me',
      containsRenderedKeyword(keywordText, requesterTagFor(currentUsername))
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
    const toggle = document.getElementById('pg-curation-mode-toggle');
    if (!toggle) {
      return;
    }
    const enabled = root.dataset.pgCurationMode === 'enabled';
    toggle.setAttribute('aria-checked', String(enabled));
    const indicator = toggle.querySelector('.pg-curation-mode-indicator');
    if (indicator) {
      indicator.textContent = enabled ? '☑' : '☐';
    }
  };

  const ensureModeToggle = () => {
    if (Number(globalThis.ServerInject?.user?.role ?? 0) < 3) {
      return;
    }
    const frameButton = document.getElementById('button-frame-menu');
    const menu = frameButton?.closest('.dropdown')?.querySelector('.dropdown-menu') ||
      frameButton?.parentElement?.querySelector('.dropdown-menu');
    if (!menu || document.getElementById('pg-curation-mode-toggle')) {
      return;
    }
    const toggle = document.createElement('button');
    toggle.id = 'pg-curation-mode-toggle';
    toggle.type = 'button';
    toggle.className = 'dropdown-item';
    toggle.setAttribute('role', 'menuitemcheckbox');
    const indicator = document.createElement('span');
    indicator.className = 'pg-curation-mode-indicator';
    const label = document.createElement('span');
    label.textContent = 'Curation mode';
    toggle.append(indicator, label);
    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setCurationMode(root.dataset.pgCurationMode !== 'enabled');
    });
    menu.appendChild(toggle);
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
    close.className = 'pg-curation-dialog-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
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

  const renderRequestDetails = requests => {
    const dialog = ensureDetailsDialog();
    const body = dialog.querySelector('.pg-curation-dialog-body');
    body.replaceChildren();
    if (!Array.isArray(requests) || requests.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No request details are available for your account.';
      body.appendChild(empty);
    } else {
      for (const request of requests) {
        const section = document.createElement('section');
        section.className = 'pg-curation-request-detail';
        const title = document.createElement('strong');
        title.textContent = CATEGORY_LABELS[request.category] || String(request.category);
        const metadata = document.createElement('div');
        const date = new Date(request.requestedAt);
        metadata.textContent = `${request.requesterName} · ${
          Number.isNaN(date.getTime()) ? request.requestedAt : date.toLocaleString()
        } · ${request.state}`;
        section.append(title, metadata);
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
      renderRequestDetails(result?.requests || []);
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
    });
  };

  const startObserver = () => {
    classifyAllPhotos();
    ensureModeToggle();
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
