import {IExtensionObject} from './node_modules/pigallery2-extension-kit';
import {IMediaRequestBody} from './node_modules/pigallery2-extension-kit/lib/backend/model/extension/IExtension';
import {MediaEntity} from './node_modules/pigallery2-extension-kit/lib/backend/model/database/enitites/MediaEntity';
import {PhotoMetadata} from './node_modules/pigallery2-extension-kit/lib/common/entities/PhotoDTO';
import {UserDTO, UserRoles} from './node_modules/pigallery2-extension-kit/lib/common/entities/UserDTO';
import {ErrorCodes} from './node_modules/pigallery2-extension-kit/lib/common/entities/Error';
import {ParamsDictionary} from 'express-serve-static-core';
import {NextFunction, Request, Response} from 'express';
import {Repository} from 'typeorm';
import {CurationConfig} from './config';
import {CurationDatabase} from './src/db/database';
import {CURATION_REPOSITORY_API_VERSION, CurationRepository} from './src/db/repository';
import {Actor, MetadataCategory, applyCurationProjection} from './src/domain';
import {
  addMediaButtonWithApiRole,
  ensureSavedSearches,
  getMediaPaths,
  relativePathFromLoader,
  saveCurationProjection
} from './src/pigallery/adapter';
import {fingerprintFile} from './src/security/fingerprint';
import {resolveDatabasePath} from './src/security/paths';

let curationRepository: CurationRepository | null = null;

const actorFromUser = (user: UserDTO): Actor => ({id: String(user.id), name: user.name});
const isAdministrator = (user: UserDTO): boolean => user.role >= UserRoles.Admin;

const requireConfirmation = (body: IMediaRequestBody, field = 'confirm'): void => {
  if (body?.data?.customFields?.[field] !== true) {
    throw new Error('Explicit confirmation is required');
  }
};

const canRequestCuration = (config: CurationConfig, user: UserDTO): boolean => {
  const configured = (config.requesterAllowlist ?? '*').trim();
  if (configured === '*') {
    return true;
  }
  const accessTokens = configured
    .split(',')
    .map(token => token.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (accessTokens.includes('*')) {
    return true;
  }
  if (user.role >= UserRoles.Admin && accessTokens.includes('admin')) {
    return true;
  }
  const userName = user.name.trim().toLocaleLowerCase();
  return accessTokens.includes(`user:${userName}`) ||
    accessTokens.some(token => token !== 'admin' && token === userName);
};

type SelectedRequestTypes = {
  deletion: boolean;
  metadata: MetadataCategory[];
};

const selectedRequestTypes = (body: IMediaRequestBody | undefined): SelectedRequestTypes => {
  const fields = body?.data?.customFields || {};
  if (fields.deletion === true) {
    // Deletion is intentionally exclusive. Do not trust the browser to clear
    // correction fields: a crafted request containing both still creates only
    // the deletion request.
    return {deletion: true, metadata: []};
  }
  const metadata: MetadataCategory[] = [];
  const options: Array<[string, MetadataCategory]> = [
    ['faces', 'faces'],
    ['tags', 'tags'],
    ['location', 'location'],
    ['dateTime', 'date-time'],
    ['titleCaption', 'title-caption'],
    ['duplicate', 'duplicate'],
    ['other', 'other']
  ];
  for (const [field, category] of options) {
    if (fields[field] === true) {
      metadata.push(category);
    }
  }
  return {deletion: false, metadata};
};

const sendError = (res: Response, code: ErrorCodes, message: string): void => {
  res.json({error: {code, message}, result: null});
};

/**
 * PiGallery2 3.5.2 does not consistently apply minUserRole while rendering
 * extension buttons. Authenticate routes as User and return a normal error
 * envelope from these guards, avoiding logout and persistent server alerts.
 */
const addAdministratorGuard = (
  extension: IExtensionObject<CurationConfig>,
  apiPath: string,
  action: string,
  subject: string
): void => {
  extension.RESTApi.post.rawMiddleware(
    [apiPath], UserRoles.User,
    (req: Request, res: Response, next: NextFunction): void => {
      const user = (req as Request & {session: {context: {user: UserDTO}}}).session.context.user;
      if (isAdministrator(user)) {
        next();
        return;
      }
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to ${action} ${subject}`);
      sendError(
        res,
        ErrorCodes.PERMISSION_DENIED,
        `Administrator role is required; ${user.name} cannot moderate curation requests`
      );
    }
  );
};

const addCurationRequesterGuard = (extension: IExtensionObject<CurationConfig>): void => {
  extension.RESTApi.post.rawMiddleware(
    ['request-curation'], UserRoles.User,
    (req: Request, res: Response, next: NextFunction): void => {
      const user = (req as Request & {session: {context: {user: UserDTO}}}).session.context.user;
      if (!canRequestCuration(extension.config.getConfig(), user)) {
        extension.Logger.warn(`${user.name}: blocked unauthorized attempt to request photo curation`);
        sendError(
          res,
          ErrorCodes.PERMISSION_DENIED,
          `User ${user.name} is not allowed to request photo curation`
        );
        return;
      }
      const selected = selectedRequestTypes(req.body as IMediaRequestBody);
      if (!selected.deletion && selected.metadata.length === 0) {
        sendError(res, ErrorCodes.INPUT_ERROR, 'Select at least one requested correction');
        return;
      }
      next();
    }
  );
};

const pencilIcon = {
  viewBox: '0 0 512 512',
  items: '<path d="M410.3 231 256 76.7 58.6 274.1c-4.1 4.1-7.2 9.2-8.9 14.8L.8 455.8a32 32 0 0 0 39.7 39.7l166.9-48.9c5.6-1.7 10.7-4.7 14.8-8.9L410.3 249.6a13.2 13.2 0 0 0 0-18.6zM174.4 406.6l-82 24 24-82 58 58zM496.8 79.8 432.2 15.2a52 52 0 0 0-73.5 0l-64.4 64.4 138.1 138.1 64.4-64.4a52 52 0 0 0 0-73.5z"/>'
};

const approveIcon = {
  viewBox: '0 0 448 512',
  items: '<path d="M438.6 105.4a32 32 0 0 1 0 45.3l-256 256a32 32 0 0 1-45.3 0l-128-128a32 32 0 0 1 45.3-45.3L160 338.7 393.4 105.4a32 32 0 0 1 45.2 0z"/>'
};

const declineIcon = {
  viewBox: '0 0 384 512',
  items: '<path d="M342.6 150.6a32 32 0 0 0-45.3-45.3L192 210.7 86.6 105.4a32 32 0 0 0-45.3 45.3L146.7 256 41.4 361.4a32 32 0 0 0 45.3 45.3L192 301.3l105.4 105.4a32 32 0 0 0 45.3-45.3L237.3 256l105.3-105.4z"/>'
};

const cancelOwnRequestIcon = {
  viewBox: '0 0 512 512',
  items: '<path d="M48 224H0V56C0 42.7 10.7 32 24 32s24 10.7 24 24v62.1C91.2 45.7 170.1 0 256 0c141.4 0 256 114.6 256 256S397.4 512 256 512c-81.1 0-155.2-37.8-202.1-99.6-8-10.6-5.9-25.6 4.7-33.6s25.6-5.9 33.6 4.7C130.3 433.7 190.2 464 256 464c114.9 0 208-93.1 208-208S370.9 48 256 48c-72 0-138.7 37.5-176.6 98.6L144 144c13.3 0 24 10.7 24 24s-10.7 24-24 24H48v32z"/>'
};

export const init = async (extension: IExtensionObject<CurationConfig>): Promise<void> => {
  if (CURATION_REPOSITORY_API_VERSION !== 10) {
    throw new Error(
      'Incompatible curation-request files: replace server.js and the complete compiled src directory together'
    );
  }
  const config = extension.config.getConfig();
  const databasePath = resolveDatabasePath(config.databasePath, extension.paths.DBFolder);
  curationRepository = new CurationRepository(new CurationDatabase(databasePath), config.reasonMaxLength);
  extension.Logger.info(`Curation database: ${databasePath}`);

  extension.RESTApi.get.jsonResponse(
    ['client-permissions'], UserRoles.User,
    (_params?: ParamsDictionary, _body?: unknown, user?: UserDTO) => {
      if (!user) {
        return {
          userId: '', userName: '', canRequestCuration: false, canModerateCuration: false
        };
      }
      return {
        userId: String(user.id),
        userName: user.name,
        canRequestCuration: canRequestCuration(extension.config.getConfig(), user),
        canModerateCuration: isAdministrator(user)
      };
    }
  );

  extension.RESTApi.get.jsonResponse(
    ['request-details/:token'], UserRoles.User,
    (params?: ParamsDictionary, _body?: unknown, user?: UserDTO) => {
      if (!user || !params?.token) {
        return {requests: [], media: null, canModerate: false};
      }
      const administrator = isAdministrator(user);
      const requests = curationRepository!.getClientRequestDetails(
        params.token,
        actorFromUser(user),
        administrator
      );
      return {
        requests,
        media: requests.length > 0
          ? curationRepository!.getRelativePathForToken(params.token)
          : null,
        canModerate: administrator
      };
    }
  );

  addAdministratorGuard(
    extension,
    'review-metadata-request',
    'review',
    'an individual metadata request'
  );
  extension.RESTApi.post.mediaJsonResponse(
    ['review-metadata-request'],
    UserRoles.User,
    true,
    async (_params, body, user, media, mediaRepository) => {
      if (!isAdministrator(user)) {
        extension.Logger.warn(
          `${user.name}: blocked unauthorized attempt to review an individual metadata request`
        );
        return;
      }
      const requestId = Number(body?.data?.customFields?.requestId);
      const outcomeValue = body?.data?.customFields?.outcome;
      if (!Number.isInteger(requestId) || requestId <= 0) {
        throw new Error('A valid metadata request ID is required');
      }
      if (!['APPROVED', 'RESOLVED', 'DISMISSED'].includes(outcomeValue)) {
        throw new Error('Metadata request outcome must be APPROVED, RESOLVED, or DISMISSED');
      }
      const mediaPaths = getMediaPaths(extension, media);
      const result = curationRepository!.closeMetadataRequest(
        mediaPaths.relativePath,
        requestId,
        actorFromUser(user),
        outcomeValue as 'APPROVED' | 'RESOLVED' | 'DISMISSED'
      );
      await saveCurationProjection(
        media,
        mediaRepository,
        curationRepository!.getProjection(mediaPaths.relativePath)
      );
      extension.Logger.info(
        `${user.name}: ${outcomeValue.toLocaleLowerCase()} metadata request ${requestId} for ${mediaPaths.relativePath}`
      );
      return {requestId: result.id, state: outcomeValue};
    }
  );

  extension.RESTApi.post.mediaJsonResponse(
    ['cancel-own-request'],
    UserRoles.User,
    true,
    async (_params, body, user, media, mediaRepository) => {
      const requestId = Number(body?.data?.customFields?.requestId);
      const kind = body?.data?.customFields?.kind;
      if (!Number.isInteger(requestId) || requestId <= 0) {
        throw new Error('A valid curation request ID is required');
      }
      if (kind !== 'metadata' && kind !== 'deletion') {
        throw new Error('Curation request kind must be metadata or deletion');
      }
      const mediaPaths = getMediaPaths(extension, media);
      const actor = actorFromUser(user);
      if (kind === 'metadata') {
        curationRepository!.withdrawOwnMetadataRequest(
          mediaPaths.relativePath,
          requestId,
          actor
        );
      } else {
        const result = curationRepository!.withdrawOwnDeletionRequest(
          mediaPaths.relativePath,
          actor,
          requestId
        );
        if (result.status !== 'withdrawn') {
          throw new Error('This photo has no matching active deletion request owned by this user');
        }
      }
      await saveCurationProjection(
        media,
        mediaRepository,
        curationRepository!.getProjection(mediaPaths.relativePath)
      );
      extension.Logger.info(
        `${user.name}: withdrew own ${kind} request ${requestId} for ${mediaPaths.relativePath}`
      );
      return {requestId, state: 'WITHDRAWN'};
    }
  );

  await ensureSavedSearches(extension);

  extension.events.gallery.MetadataLoader.loadPhotoMetadata.after(async (data: {
    input: [string];
    output: PhotoMetadata;
  }): Promise<PhotoMetadata> => {
    const relativePath = relativePathFromLoader(extension, data.input[0]);
    if (relativePath) {
      data.output.keywords = applyCurationProjection(
        data.output.keywords,
        curationRepository?.getProjection(relativePath)
      );
    }
    return data.output;
  });

  addCurationRequesterGuard(extension);
  extension.ui.addMediaButton({
    name: 'Request curation',
    svgIcon: pencilIcon,
    apiPath: 'request-curation',
    minUserRole: UserRoles.User,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Request a correction',
      body: 'Select one or more problems. Nothing in the photo library is changed until an administrator reviews the request.',
      buttonString: 'Submit request',
      customFields: [
        {id: 'faces', label: '👤 Wrong or missing faces', type: 'boolean', defaultValue: false},
        {id: 'tags', label: '🏷 Wrong or missing tags', type: 'boolean', defaultValue: false},
        {id: 'location', label: '📍 Wrong or missing location', type: 'boolean', defaultValue: false},
        {id: 'dateTime', label: '🕒 Wrong date or time', type: 'boolean', defaultValue: false},
        {id: 'titleCaption', label: '📝 Wrong or missing title/caption', type: 'boolean', defaultValue: false},
        {id: 'duplicate', label: '🖼 Duplicate photo', type: 'boolean', defaultValue: false},
        {id: 'other', label: '❓ Other', type: 'boolean', defaultValue: false},
        {id: 'deletion', label: '🗑 Request deletion', type: 'boolean', defaultValue: false},
        {id: 'comment', label: 'Comment (optional)', type: 'string', defaultValue: ''}
      ]
    }
  }, async (
    _params: ParamsDictionary,
    body: IMediaRequestBody,
    user: UserDTO,
    media: MediaEntity,
    mediaRepository: Repository<MediaEntity>
  ): Promise<void> => {
    if (!canRequestCuration(extension.config.getConfig(), user)) {
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to request photo curation`);
      return;
    }
    const selected = selectedRequestTypes(body);
    if (!selected.deletion && selected.metadata.length === 0) {
      throw new Error('At least one requested correction is required');
    }
    const mediaPaths = getMediaPaths(extension, media);
    const actor = actorFromUser(user);
    const comment = body?.data?.customFields?.comment;
    if (curationRepository!.getState(mediaPaths.relativePath) === 'APPROVED') {
      extension.Logger.warn(
        `${user.name}: blocked new curation request while deletion is approved for ${mediaPaths.relativePath}`
      );
      await saveCurationProjection(
        media,
        mediaRepository,
        curationRepository!.getProjection(mediaPaths.relativePath)
      );
      return;
    }
    if (
      selected.metadata.length > 0 &&
      curationRepository!.hasActiveDeletionRequest(mediaPaths.relativePath, actor.id)
    ) {
      extension.Logger.warn(
        `${user.name}: ignored metadata request while their deletion request is active for ${mediaPaths.relativePath}`
      );
      // Also refresh an older cached projection so the per-user pencil becomes
      // hidden after upgrading from a release without deletion-owner tags.
      await saveCurationProjection(
        media,
        mediaRepository,
        curationRepository!.getProjection(mediaPaths.relativePath)
      );
      return;
    }
    if (selected.deletion) {
      const fingerprint = await fingerprintFile(mediaPaths.absolutePath);
      curationRepository!.requestDeletion({
        relativePath: mediaPaths.relativePath,
        mediaType: 'photo',
        fingerprint,
        actor,
        reason: comment
      });
    }
    if (selected.metadata.length > 0) {
      curationRepository!.requestMetadata({
        relativePath: mediaPaths.relativePath,
        mediaType: 'photo',
        categories: selected.metadata,
        actor,
        comment
      });
    }
    await saveCurationProjection(
      media,
      mediaRepository,
      curationRepository!.getProjection(mediaPaths.relativePath)
    );
    extension.Logger.info(
      `${user.name}: requested ${[
        ...(selected.deletion ? ['deletion'] : []),
        ...selected.metadata
      ].join(', ')} for ${mediaPaths.relativePath}`
    );
  });

  extension.ui.addMediaButton({
    name: 'Cancel my curation requests',
    svgIcon: cancelOwnRequestIcon,
    apiPath: 'cancel-own-curation-requests',
    minUserRole: UserRoles.User,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Cancel your curation requests?',
      body: 'All of your active requests for this photo will be withdrawn. Requests made by other people are not affected.',
      buttonString: 'Cancel my requests',
      customFields: [
        {id: 'confirm', label: 'Yes, withdraw my active requests', type: 'boolean', defaultValue: false, required: true}
      ]
    }
  }, async (
    _params: ParamsDictionary,
    body: IMediaRequestBody,
    user: UserDTO,
    media: MediaEntity,
    mediaRepository: Repository<MediaEntity>
  ): Promise<void> => {
    requireConfirmation(body);
    const mediaPaths = getMediaPaths(extension, media);
    const result = curationRepository!.withdrawOwnCurationRequests(
      mediaPaths.relativePath,
      actorFromUser(user)
    );
    if (!result.deletionWithdrawn && result.metadataWithdrawn === 0) {
      extension.Logger.warn(
        `${user.name}: blocked attempt to cancel another user's or inactive requests for ${mediaPaths.relativePath}`
      );
      return;
    }
    await saveCurationProjection(
      media,
      mediaRepository,
      curationRepository!.getProjection(mediaPaths.relativePath)
    );
    extension.Logger.info(
      `${user.name}: withdrew own curation requests for ${mediaPaths.relativePath}`
    );
  });

  addAdministratorGuard(extension, 'approve-all-metadata-requests', 'approve', 'all metadata requests');
  addMediaButtonWithApiRole(extension, {
    name: 'Approve all metadata requests (admin only)',
    svgIcon: approveIcon,
    apiPath: 'approve-all-metadata-requests',
    minUserRole: UserRoles.Admin,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Approve all metadata requests?',
      body: 'Accepts every pending metadata request for this photo as manual work to complete.',
      buttonString: 'Approve all',
      customFields: [
        {id: 'confirm', label: 'Yes, approve all pending metadata requests', type: 'boolean', defaultValue: false, required: true}
      ]
    }
  }, UserRoles.Admin, async (
    _params, body, user, media, mediaRepository
  ): Promise<void> => {
    if (!isAdministrator(user)) {
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to approve all metadata requests`);
      return;
    }
    requireConfirmation(body);
    const mediaPaths = getMediaPaths(extension, media);
    curationRepository!.approveMetadataRequests(
      mediaPaths.relativePath,
      actorFromUser(user)
    );
    await saveCurationProjection(media, mediaRepository, curationRepository!.getProjection(mediaPaths.relativePath));
  });

  addAdministratorGuard(extension, 'mark-all-metadata-requests-done', 'complete', 'all metadata requests');
  addMediaButtonWithApiRole(extension, {
    name: 'Mark all metadata requests done (admin only)',
    svgIcon: approveIcon,
    apiPath: 'mark-all-metadata-requests-done',
    minUserRole: UserRoles.Admin,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Mark all metadata requests done?',
      body: 'Use this only after completing every approved metadata correction for this photo.',
      buttonString: 'Mark all done',
      customFields: [
        {id: 'resolutionComment', label: 'Resolution comment (optional)', type: 'string', defaultValue: ''},
        {id: 'confirm', label: 'Yes, all approved corrections are complete', type: 'boolean', defaultValue: false, required: true}
      ]
    }
  }, UserRoles.Admin, async (
    _params, body, user, media, mediaRepository
  ): Promise<void> => {
    if (!isAdministrator(user)) {
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to complete all metadata requests`);
      return;
    }
    requireConfirmation(body);
    const mediaPaths = getMediaPaths(extension, media);
    curationRepository!.closeMetadataRequests(
      mediaPaths.relativePath,
      actorFromUser(user),
      'RESOLVED',
      body?.data?.customFields?.resolutionComment
    );
    await saveCurationProjection(media, mediaRepository, curationRepository!.getProjection(mediaPaths.relativePath));
  });

  addAdministratorGuard(extension, 'decline-all-metadata-requests', 'decline', 'all metadata requests');
  addMediaButtonWithApiRole(extension, {
    name: 'Decline all metadata requests (admin only)',
    svgIcon: declineIcon,
    apiPath: 'decline-all-metadata-requests',
    minUserRole: UserRoles.Admin,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Decline all metadata requests?',
      body: 'Declines every pending or approved metadata request for this photo without changing the photo.',
      buttonString: 'Decline all',
      customFields: [
        {id: 'resolutionComment', label: 'Decline comment (optional)', type: 'string', defaultValue: ''},
        {id: 'confirm', label: 'Yes, decline all metadata requests', type: 'boolean', defaultValue: false, required: true}
      ]
    }
  }, UserRoles.Admin, async (
    _params, body, user, media, mediaRepository
  ): Promise<void> => {
    if (!isAdministrator(user)) {
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to decline all metadata requests`);
      return;
    }
    requireConfirmation(body);
    const mediaPaths = getMediaPaths(extension, media);
    curationRepository!.closeMetadataRequests(
      mediaPaths.relativePath,
      actorFromUser(user),
      'DISMISSED',
      body?.data?.customFields?.resolutionComment
    );
    await saveCurationProjection(media, mediaRepository, curationRepository!.getProjection(mediaPaths.relativePath));
  });

  addAdministratorGuard(extension, 'approve-deletion', 'approve', 'a deletion request');
  addMediaButtonWithApiRole(extension, {
    name: 'Approve deletion (admin only)',
    svgIcon: approveIcon,
    apiPath: 'approve-deletion',
    minUserRole: UserRoles.Admin,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Approve deletion?',
      body: 'Approval does not delete this file; it adds the photo to the host-side deletion queue.',
      buttonString: 'Approve',
      customFields: [
        {id: 'confirm', label: 'Yes, approve this photo for permanent deletion', type: 'boolean', defaultValue: false, required: true}
      ]
    }
  }, UserRoles.Admin, async (
    _params, body, user, media, mediaRepository
  ): Promise<void> => {
    if (!isAdministrator(user)) {
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to approve a deletion request`);
      return;
    }
    requireConfirmation(body);
    const mediaPaths = getMediaPaths(extension, media);
    const fingerprint = await fingerprintFile(mediaPaths.absolutePath);
    curationRepository!.approve(mediaPaths.relativePath, actorFromUser(user), fingerprint);
    await saveCurationProjection(media, mediaRepository, curationRepository!.getProjection(mediaPaths.relativePath));
  });

  addAdministratorGuard(extension, 'decline-deletion', 'decline', 'a deletion request');
  addMediaButtonWithApiRole(extension, {
    name: 'Decline deletion (admin only)',
    svgIcon: declineIcon,
    apiPath: 'decline-deletion',
    minUserRole: UserRoles.Admin,
    skipVideos: true,
    reloadContent: true,
    popup: {
      header: 'Decline deletion request?',
      body: 'Removes pending, approved, or failed deletion work from the active queue. Request history is retained.',
      buttonString: 'Decline',
      customFields: [
        {id: 'confirm', label: 'Yes, decline this deletion request', type: 'boolean', defaultValue: false, required: true}
      ]
    }
  }, UserRoles.Admin, async (
    _params, body, user, media, mediaRepository
  ): Promise<void> => {
    if (!isAdministrator(user)) {
      extension.Logger.warn(`${user.name}: blocked unauthorized attempt to decline a deletion request`);
      return;
    }
    requireConfirmation(body);
    const mediaPaths = getMediaPaths(extension, media);
    curationRepository!.decline(mediaPaths.relativePath, actorFromUser(user));
    await saveCurationProjection(media, mediaRepository, curationRepository!.getProjection(mediaPaths.relativePath));
  });
};

export const cleanUp = async (): Promise<void> => {
  curationRepository?.close();
  curationRepository = null;
};
