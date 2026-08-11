(() => {
  'use strict';

  const EXTENSION_ID = 'pigallery2-curation-deletion-review';
  const TAG_PREFIX = 'pg-curation:';
  const TAG_APPROVED = 'pg-curation:delete-approved';
  const TAG_ERROR = 'pg-curation:delete-error';
  const TAG_REQUESTED_BY_PREFIX = 'pg-curation:requested-by:';

  const root = document.documentElement;
  let currentUsername = '';

  root.dataset.pgCurationPermissionsLoaded = 'false';
  root.dataset.pgCanRequestDeletion = 'false';
  root.dataset.pgCanModerateDeletion = 'false';

  const stateRules = `
    /* Fail closed until authenticated permissions arrive from the extension. */
    html:not([data-pg-curation-permissions-loaded="true"])
      button[title="Request deletion"],
    html:not([data-pg-curation-permissions-loaded="true"])
      button[title="Cancel my deletion request"],
    html:not([data-pg-curation-permissions-loaded="true"])
      button[title="Approve deletion (admin only)"],
    html:not([data-pg-curation-permissions-loaded="true"])
      button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    html[data-pg-can-request-deletion="false"]
      button[title="Request deletion"] {
      display: none !important;
    }

    html[data-pg-can-moderate-deletion="false"]
      button[title="Approve deletion (admin only)"],
    html[data-pg-can-moderate-deletion="false"]
      button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    /* Prevent buttons briefly appearing before per-photo classification. */
    .photo-container:not(.pg-curation-classified)
      button[title="Request deletion"],
    .photo-container:not(.pg-curation-classified)
      button[title="Cancel my deletion request"],
    .photo-container:not(.pg-curation-classified)
      button[title="Approve deletion (admin only)"],
    .photo-container:not(.pg-curation-classified)
      button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    /* No curation state: only Request may be displayed. */
    .photo-container:not(.pg-curation-present)
      button[title="Cancel my deletion request"],
    .photo-container:not(.pg-curation-present)
      button[title="Approve deletion (admin only)"],
    .photo-container:not(.pg-curation-present)
      button[title="Decline deletion (admin only)"] {
      display: none !important;
    }

    /* Any active curation state hides Request. */
    .photo-container.pg-curation-present
      button[title="Request deletion"] {
      display: none !important;
    }

    /* Only the current requester may see their own Cancel button. */
    .photo-container:not(.pg-curation-requested-by-me)
      button[title="Cancel my deletion request"] {
      display: none !important;
    }

    /* Approved: hide Approve, leaving admin Decline and requester Cancel. */
    .photo-container.pg-curation-approved
      button[title="Approve deletion (admin only)"] {
      display: none !important;
    }

    /* Error: only an owning requester may cancel their own request. */
    .photo-container.pg-curation-error
      button[title="Approve deletion (admin only)"],
    .photo-container.pg-curation-error
      button[title="Decline deletion (admin only)"] {
      display: none !important;
    }
  `;

  document
    .getElementById('pg2-curation-button-permissions')
    ?.remove();

  const style = document.createElement('style');
  style.id = 'pg2-curation-button-permissions';
  style.textContent = stateRules;
  document.head.appendChild(style);

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
    const expression = new RegExp(
      `(?:^|[#\\s,])${escapeRegularExpression(keyword)}(?=$|[#\\s,])`,
      'iu'
    );
    return expression.test(renderedText);
  };

  const classifyPhoto = photoContainer => {
    const keywordText =
      photoContainer.querySelector('.photo-keywords')?.textContent ?? '';

    photoContainer.classList.toggle(
      'pg-curation-present',
      keywordText.includes(TAG_PREFIX)
    );
    photoContainer.classList.toggle(
      'pg-curation-approved',
      keywordText.includes(TAG_APPROVED)
    );
    photoContainer.classList.toggle(
      'pg-curation-error',
      keywordText.includes(TAG_ERROR)
    );
    photoContainer.classList.toggle(
      'pg-curation-requested-by-me',
      containsRenderedKeyword(keywordText, requesterTagFor(currentUsername))
    );
    photoContainer.classList.add('pg-curation-classified');
  };

  const classifyAllPhotos = () => {
    document
      .querySelectorAll('.photo-container')
      .forEach(classifyPhoto);
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
    });
  };

  const permissionEndpoint = () => {
    const injected = globalThis.ServerInject;
    const apiPath = String(
      injected?.ConfigInject?.Server?.apiPath ?? '/pgapi'
    ).replace(/\/$/, '');
    const uiConfig = injected?.UIExtensionConfigs?.find(config =>
      config?.mediaButtons?.some(button => button?.apiPath === 'request-deletion')
    );
    const extensionBasePath = String(
      uiConfig?.extensionBasePath ?? `/extension/${EXTENSION_ID}`
    );
    return `${apiPath}${extensionBasePath}/client-permissions`;
  };

  const loadPermissions = async () => {
    const injectedUser = globalThis.ServerInject?.user;
    if (Number(injectedUser?.role ?? 0) < 3) {
      return;
    }

    try {
      const response = await fetch(permissionEndpoint(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {Accept: 'application/json'}
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const envelope = await response.json();
      const permissions = envelope?.result ?? envelope;
      if (
        typeof permissions?.userName !== 'string' ||
        typeof permissions?.canRequestDeletion !== 'boolean' ||
        typeof permissions?.canModerateDeletion !== 'boolean'
      ) {
        throw new Error('invalid permission response');
      }

      currentUsername = permissions.userName.trim();
      root.dataset.pgUser = currentUsername;
      root.dataset.pgCanRequestDeletion =
        String(permissions.canRequestDeletion);
      root.dataset.pgCanModerateDeletion =
        String(permissions.canModerateDeletion);
      root.dataset.pgCurationPermissionsLoaded = 'true';
      scheduleRefresh();
    } catch (error) {
      console.error(
        `[${EXTENSION_ID}] Could not load button permissions; actions remain hidden.`,
        error
      );
    }
  };

  const startObserver = () => {
    classifyAllPhotos();

    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    void loadPermissions();
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      startObserver,
      {once: true}
    );
  } else {
    startObserver();
  }
})();
