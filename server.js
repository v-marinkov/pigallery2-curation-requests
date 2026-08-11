"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanUp = exports.init = void 0;
const UserDTO_1 = require("./node_modules/pigallery2-extension-kit/lib/common/entities/UserDTO");
const Error_1 = require("./node_modules/pigallery2-extension-kit/lib/common/entities/Error");
const database_1 = require("./src/db/database");
const repository_1 = require("./src/db/repository");
const domain_1 = require("./src/domain");
const adapter_1 = require("./src/pigallery/adapter");
const fingerprint_1 = require("./src/security/fingerprint");
const paths_1 = require("./src/security/paths");
let curationRepository = null;
const actorFromUser = (user) => ({ id: String(user.id), name: user.name });
const requireConfirmation = (body, field = 'confirm') => {
    if (body?.data?.customFields?.[field] !== true) {
        throw new Error('Explicit confirmation is required');
    }
};
const canRequestDeletion = (config, user) => {
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
    if (user.role >= UserDTO_1.UserRoles.Admin && accessTokens.includes('admin')) {
        return true;
    }
    const userName = user.name.trim().toLocaleLowerCase();
    return accessTokens.includes(`user:${userName}`) ||
        accessTokens.some(token => token !== 'admin' && token === userName);
};
const isAdministrator = (user) => user.role >= UserDTO_1.UserRoles.Admin;
/**
 * PiGallery2 3.5.2 does not apply minUserRole while rendering extension
 * buttons. Guard the route as User first so a non-admin receives a normal
 * PERMISSION_DENIED response instead of reaching PiGallery2's Admin
 * middleware (which logs the user out) or throwing an extension error (which
 * creates a persistent server notification).
 */
const addAdministratorGuard = (extension, apiPath, action) => {
    extension.RESTApi.post.rawMiddleware([apiPath], UserDTO_1.UserRoles.User, (req, res, next) => {
        const user = req.session.context.user;
        if (isAdministrator(user)) {
            next();
            return;
        }
        extension.Logger.warn(`${user.name}: blocked unauthorized attempt to ${action} a deletion request`);
        res.json({
            error: {
                code: Error_1.ErrorCodes.PERMISSION_DENIED,
                message: `Administrator role is required; ${user.name} cannot moderate deletion requests`
            },
            result: null
        });
    });
};
const addDeletionRequesterGuard = (extension) => {
    extension.RESTApi.post.rawMiddleware(['request-deletion'], UserDTO_1.UserRoles.User, (req, res, next) => {
        const user = req.session.context.user;
        if (canRequestDeletion(extension.config.getConfig(), user)) {
            next();
            return;
        }
        extension.Logger.warn(`${user.name}: blocked unauthorized attempt to request photo deletion`);
        res.json({
            error: {
                code: Error_1.ErrorCodes.PERMISSION_DENIED,
                message: `User ${user.name} is not allowed to request photo deletions`
            },
            result: null
        });
    });
};
const deleteIcon = {
    viewBox: '0 0 448 512',
    items: '<path d="M135.2 17.7 128 40H32C14.3 40 0 54.3 0 72s14.3 32 32 32h384c17.7 0 32-14.3 32-32s-14.3-32-32-32h-96l-7.2-22.3A32 32 0 0 0 282.4-4H165.6a32 32 0 0 0-30.4 21.7zM53.2 152l20.2 312.9A48 48 0 0 0 121.3 510h205.4a48 48 0 0 0 47.9-45.1L394.8 152H53.2z"/>'
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
const init = async (extension) => {
    if (repository_1.CURATION_REPOSITORY_API_VERSION !== 3) {
        throw new Error('Incompatible deletion-review files: replace server.js and the complete compiled src directory together');
    }
    const config = extension.config.getConfig();
    const databasePath = (0, paths_1.resolveDatabasePath)(config.databasePath, extension.paths.DBFolder);
    curationRepository = new repository_1.CurationRepository(new database_1.CurationDatabase(databasePath), config.reasonMaxLength);
    extension.Logger.info(`Curation database: ${databasePath}`);
    extension.RESTApi.get.jsonResponse(['client-permissions'], UserDTO_1.UserRoles.User, (_params, _body, user) => {
        if (!user) {
            return {
                userName: '',
                canRequestDeletion: false,
                canModerateDeletion: false
            };
        }
        const currentConfig = extension.config.getConfig();
        return {
            userName: user.name,
            canRequestDeletion: canRequestDeletion(currentConfig, user),
            canModerateDeletion: isAdministrator(user)
        };
    });
    await (0, adapter_1.ensureSavedSearches)(extension);
    extension.events.gallery.MetadataLoader.loadPhotoMetadata.after(async (data) => {
        const relativePath = (0, adapter_1.relativePathFromLoader)(extension, data.input[0]);
        if (relativePath) {
            data.output.keywords = (0, domain_1.applyCurationProjection)(data.output.keywords, curationRepository?.getProjection(relativePath));
        }
        return data.output;
    });
    addDeletionRequesterGuard(extension);
    extension.ui.addMediaButton({
        name: 'Request deletion',
        svgIcon: deleteIcon,
        apiPath: 'request-deletion',
        minUserRole: UserDTO_1.UserRoles.User,
        skipVideos: true,
        reloadContent: true,
        popup: {
            header: 'Request deletion?',
            body: 'This photo will not be deleted immediately. Your request will be reviewed by an administrator.',
            buttonString: 'Request deletion',
            customFields: [
                { id: 'reason', label: 'Reason (optional)', type: 'string', defaultValue: '' },
                { id: 'confirm', label: 'I am sure I want to request deletion', type: 'boolean', defaultValue: false, required: true }
            ]
        }
    }, async (_params, body, user, media, mediaRepository) => {
        if (!canRequestDeletion(extension.config.getConfig(), user)) {
            extension.Logger.warn(`${user.name}: blocked unauthorized attempt to request photo deletion`);
            return;
        }
        requireConfirmation(body);
        const mediaPaths = (0, adapter_1.getMediaPaths)(extension, media);
        const fingerprint = await (0, fingerprint_1.fingerprintFile)(mediaPaths.absolutePath);
        const result = curationRepository.requestDeletion({
            relativePath: mediaPaths.relativePath,
            mediaType: 'photo',
            fingerprint,
            actor: actorFromUser(user),
            reason: body?.data?.customFields?.reason
        });
        await (0, adapter_1.saveCurationProjection)(media, mediaRepository, curationRepository.getProjection(mediaPaths.relativePath));
        extension.Logger.info(`${user.name}: ${result.status} deletion for ${mediaPaths.relativePath}`);
    });
    extension.ui.addMediaButton({
        name: 'Cancel my deletion request',
        svgIcon: cancelOwnRequestIcon,
        apiPath: 'cancel-own-deletion-request',
        minUserRole: UserDTO_1.UserRoles.User,
        skipVideos: true,
        reloadContent: true,
        popup: {
            header: 'Cancel your deletion request?',
            body: 'Only your own request will be withdrawn. Requests made by other family members are not affected.',
            buttonString: 'Cancel my request',
            customFields: [
                { id: 'confirm', label: 'Yes, withdraw my deletion request', type: 'boolean', defaultValue: false, required: true }
            ]
        }
    }, async (_params, body, user, media, mediaRepository) => {
        requireConfirmation(body);
        const mediaPaths = (0, adapter_1.getMediaPaths)(extension, media);
        const result = curationRepository.withdrawOwnDeletionRequest(mediaPaths.relativePath, actorFromUser(user));
        if (result.status !== 'withdrawn') {
            extension.Logger.warn(`${user.name}: blocked attempt to cancel another user's or inactive deletion request for ${mediaPaths.relativePath}`);
            return;
        }
        await (0, adapter_1.saveCurationProjection)(media, mediaRepository, curationRepository.getProjection(mediaPaths.relativePath));
        extension.Logger.info(`${user.name}: withdrew own deletion request for ${mediaPaths.relativePath}; ` +
            `${result.remainingRequesters} active requester(s) remain`);
    });
    addAdministratorGuard(extension, 'approve-deletion', 'approve');
    (0, adapter_1.addMediaButtonWithApiRole)(extension, {
        name: 'Approve deletion (admin only)',
        svgIcon: approveIcon,
        apiPath: 'approve-deletion',
        minUserRole: UserDTO_1.UserRoles.Admin,
        skipVideos: true,
        reloadContent: true,
        popup: {
            header: 'Approve deletion?',
            body: 'Administrators only. Approval does NOT delete this file; it adds the photo to the host-side deletion queue.',
            buttonString: 'Approve',
            customFields: [
                { id: 'confirm', label: 'Yes, approve this photo for permanent deletion', type: 'boolean', defaultValue: false, required: true }
            ]
        }
    }, UserDTO_1.UserRoles.Admin, async (_params, body, user, media, mediaRepository) => {
        if (!isAdministrator(user)) {
            extension.Logger.warn(`${user.name}: blocked unauthorized attempt to approve a deletion request`);
            return;
        }
        requireConfirmation(body);
        const mediaPaths = (0, adapter_1.getMediaPaths)(extension, media);
        const fingerprint = await (0, fingerprint_1.fingerprintFile)(mediaPaths.absolutePath);
        const item = curationRepository.approve(mediaPaths.relativePath, actorFromUser(user), fingerprint);
        await (0, adapter_1.saveCurationProjection)(media, mediaRepository, curationRepository.getProjection(mediaPaths.relativePath));
        extension.Logger.info(`${user.name}: approved deletion for ${mediaPaths.relativePath}`);
    });
    addAdministratorGuard(extension, 'decline-deletion', 'decline');
    (0, adapter_1.addMediaButtonWithApiRole)(extension, {
        name: 'Decline deletion (admin only)',
        svgIcon: declineIcon,
        apiPath: 'decline-deletion',
        minUserRole: UserDTO_1.UserRoles.Admin,
        skipVideos: true,
        reloadContent: true,
        popup: {
            header: 'Decline deletion request?',
            body: 'Administrators only. Pending, approved, or failed deletion work will be removed from the active queue. The photo remains in the family library and request history is retained for audit.',
            buttonString: 'Decline',
            customFields: [
                { id: 'confirm', label: 'Yes, decline this deletion request', type: 'boolean', defaultValue: false, required: true }
            ]
        }
    }, UserDTO_1.UserRoles.Admin, async (_params, body, user, media, mediaRepository) => {
        if (!isAdministrator(user)) {
            extension.Logger.warn(`${user.name}: blocked unauthorized attempt to decline a deletion request`);
            return;
        }
        requireConfirmation(body);
        const mediaPaths = (0, adapter_1.getMediaPaths)(extension, media);
        const item = curationRepository.decline(mediaPaths.relativePath, actorFromUser(user));
        await (0, adapter_1.saveCurationProjection)(media, mediaRepository, curationRepository.getProjection(mediaPaths.relativePath));
        extension.Logger.info(`${user.name}: declined deletion for ${mediaPaths.relativePath}`);
    });
};
exports.init = init;
const cleanUp = async () => {
    curationRepository?.close();
    curationRepository = null;
};
exports.cleanUp = cleanUp;
//# sourceMappingURL=server.js.map