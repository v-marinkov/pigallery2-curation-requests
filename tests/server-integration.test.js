"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs_1 = require("fs");
const os_1 = require("os");
const path = __importStar(require("path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const UserDTO_1 = require("../node_modules/pigallery2-extension-kit/lib/common/entities/UserDTO");
const server_1 = require("../server");
(0, node_test_1.it)('registers and executes the PiGallery2 request/approval workflow without changing the photo', async () => {
    const root = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'pg2-server-test-'));
    const imageRoot = path.join(root, 'images');
    const databaseRoot = path.join(root, 'db');
    const directory = path.join(imageRoot, '2024', 'Christmas');
    (0, fs_1.mkdirSync)(directory, { recursive: true });
    (0, fs_1.mkdirSync)(databaseRoot, { recursive: true });
    const photoPath = path.join(directory, 'photo.jpg');
    (0, fs_1.writeFileSync)(photoPath, 'photo remains read only');
    const buttons = new Map();
    const apiRoles = new Map();
    const guards = new Map();
    const jsonRoutes = new Map();
    const uiButtonConfigs = [];
    const warnings = [];
    let metadataAfter = null;
    const albums = [];
    const extension = {
        config: { getConfig: () => ({
                databasePath: 'curation/curation.sqlite', reasonMaxLength: 4000, requesterAllowlist: 'admin, anna'
            }) },
        paths: { DBFolder: databaseRoot, ImageFolder: imageRoot },
        Logger: {
            info: () => undefined,
            debug: () => undefined,
            warn: (message) => { warnings.push(message); }
        },
        _app: { objectManagers: { AlbumManager: {
                    addIfNotExistSavedSearch: async (name) => { albums.push(name); }
                } } },
        events: { gallery: { MetadataLoader: { loadPhotoMetadata: {
                        after: (handler) => { metadataAfter = handler; }
                    } } } },
        RESTApi: {
            get: {
                jsonResponse: (paths, role, callback) => {
                    jsonRoutes.set(paths[0], { role, callback });
                    return paths[0];
                }
            },
            post: {
                mediaJsonResponse: (paths, role, _invalidate, callback) => {
                    const config = uiButtonConfigs.find(entry => entry.apiPath === paths[0]);
                    buttons.set(config.name, { config, callback });
                    apiRoles.set(config.name, role);
                    return paths[0];
                },
                rawMiddleware: (paths, role, middleware) => {
                    guards.set(paths[0], { role, middleware });
                    return paths[0];
                }
            }
        },
        ui: {
            buttonConfigs: uiButtonConfigs,
            addMediaButton: (config, callback) => {
                uiButtonConfigs.push(config);
                buttons.set(config.name, { config, callback });
            }
        }
    };
    const media = {
        id: 7,
        name: 'photo.jpg',
        directory: { path: '2024/', name: 'Christmas' },
        metadata: { keywords: ['family'] }
    };
    const saved = [];
    const mediaRepository = { save: async (value) => { saved.push(value); } };
    try {
        await (0, server_1.init)(extension);
        strict_1.default.deepEqual(albums, ['🗑 Deletion requests', '✓ Approved for deletion', '⚠ Deletion errors']);
        strict_1.default.equal(buttons.get('Request deletion')?.config.minUserRole, UserDTO_1.UserRoles.User);
        strict_1.default.equal(buttons.get('Cancel my deletion request')?.config.minUserRole, UserDTO_1.UserRoles.User);
        strict_1.default.equal(buttons.get('Approve deletion (admin only)')?.config.minUserRole, UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(buttons.get('Decline deletion (admin only)')?.config.minUserRole, UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(apiRoles.get('Approve deletion (admin only)'), UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(apiRoles.get('Decline deletion (admin only)'), UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(guards.get('approve-deletion')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.equal(guards.get('decline-deletion')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.equal(guards.get('request-deletion')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.equal(jsonRoutes.get('client-permissions')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.deepEqual(jsonRoutes.get('client-permissions')?.callback(undefined, undefined, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User }), { userName: 'anna', canRequestDeletion: true, canModerateDeletion: false });
        strict_1.default.deepEqual(jsonRoutes.get('client-permissions')?.callback(undefined, undefined, { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User }), { userName: 'bob', canRequestDeletion: false, canModerateDeletion: false });
        strict_1.default.deepEqual(jsonRoutes.get('client-permissions')?.callback(undefined, undefined, { id: 9, name: 'site-admin', role: UserDTO_1.UserRoles.Admin }), { userName: 'site-admin', canRequestDeletion: true, canModerateDeletion: true });
        const deniedResponses = [];
        let guardContinued = false;
        guards.get('approve-deletion').middleware({ session: { context: { user: { id: 1, name: 'ordinary-user', role: UserDTO_1.UserRoles.User } } } }, { json: (body) => { deniedResponses.push(body); } }, () => { guardContinued = true; });
        strict_1.default.equal(guardContinued, false);
        strict_1.default.equal(deniedResponses[0].error.code, 4);
        strict_1.default.match(deniedResponses[0].error.message, /Administrator role is required/);
        strict_1.default.deepEqual(warnings, [
            'ordinary-user: blocked unauthorized attempt to approve a deletion request'
        ]);
        strict_1.default.deepEqual(media.metadata.keywords, ['family']);
        strict_1.default.equal(saved.length, 0);
        guards.get('approve-deletion').middleware({ session: { context: { user: { id: 9, name: 'admin', role: UserDTO_1.UserRoles.Admin } } } }, { json: () => strict_1.default.fail('admin guard must not send a denial') }, () => { guardContinued = true; });
        strict_1.default.equal(guardContinued, true);
        guardContinued = false;
        guards.get('request-deletion').middleware({ session: { context: { user: { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User } } } }, { json: (body) => { deniedResponses.push(body); } }, () => { guardContinued = true; });
        strict_1.default.equal(guardContinued, false);
        strict_1.default.equal(deniedResponses[1].error.code, 4);
        strict_1.default.match(deniedResponses[1].error.message, /not allowed to request/);
        guardContinued = false;
        guards.get('request-deletion').middleware({ session: { context: { user: { id: 9, name: 'site-admin', role: UserDTO_1.UserRoles.Admin } } } }, { json: () => strict_1.default.fail('admin role token must allow the request') }, () => { guardContinued = true; });
        strict_1.default.equal(guardContinued, true);
        strict_1.default.deepEqual(warnings, [
            'ordinary-user: blocked unauthorized attempt to approve a deletion request',
            'bob: blocked unauthorized attempt to request photo deletion'
        ]);
        await buttons.get('Request deletion').callback({}, { data: { customFields: { confirm: true, reason: 'duplicate' } } }, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        strict_1.default.deepEqual(media.metadata.keywords, [
            'family', 'pg-curation:delete-pending', 'pg-curation:requested-by:anna'
        ]);
        strict_1.default.equal((0, fs_1.readFileSync)(photoPath, 'utf8'), 'photo remains read only');
        await buttons.get('Cancel my deletion request').callback({}, { data: { customFields: { confirm: true } } }, { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        strict_1.default.deepEqual(media.metadata.keywords, [
            'family', 'pg-curation:delete-pending', 'pg-curation:requested-by:anna'
        ]);
        strict_1.default.equal(saved.length, 1);
        await buttons.get('Approve deletion (admin only)').callback({}, { data: { customFields: { confirm: true } } }, { id: 9, name: 'admin', role: UserDTO_1.UserRoles.Admin }, media, mediaRepository);
        strict_1.default.deepEqual(media.metadata.keywords, [
            'family', 'pg-curation:delete-approved', 'pg-curation:requested-by:anna'
        ]);
        strict_1.default.equal(saved.length, 2);
        const dbPath = path.join(databaseRoot, 'curation', 'curation.sqlite');
        const database = new better_sqlite3_1.default(dbPath, { readonly: true });
        const item = database.prepare('SELECT state, approved_by_user_name FROM deletion_items').get();
        const request = database.prepare('SELECT requested_by_user_name, reason FROM deletion_requests').get();
        strict_1.default.deepEqual(item, { state: 'APPROVED', approved_by_user_name: 'admin' });
        strict_1.default.deepEqual(request, { requested_by_user_name: 'anna', reason: 'duplicate' });
        database.close();
        const reindexed = await metadataAfter({
            input: [photoPath],
            output: { keywords: ['family'], size: { width: 1, height: 1 }, fileSize: 1, creationDate: 0 }
        });
        strict_1.default.deepEqual(reindexed.keywords, [
            'family', 'pg-curation:delete-approved', 'pg-curation:requested-by:anna'
        ]);
        await buttons.get('Cancel my deletion request').callback({}, { data: { customFields: { confirm: true } } }, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        strict_1.default.deepEqual(media.metadata.keywords, ['family']);
        strict_1.default.equal(saved.length, 3);
        const cancelledDatabase = new better_sqlite3_1.default(dbPath, { readonly: true });
        const cancelledItem = cancelledDatabase.prepare('SELECT state, declined_by_user_name FROM deletion_items').get();
        const cancelledRequest = cancelledDatabase.prepare('SELECT withdrawn_at FROM deletion_requests').get();
        strict_1.default.deepEqual(cancelledItem, { state: 'DECLINED', declined_by_user_name: 'anna' });
        strict_1.default.equal(typeof cancelledRequest.withdrawn_at, 'string');
        cancelledDatabase.close();
    }
    finally {
        await (0, server_1.cleanUp)();
        (0, fs_1.rmSync)(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=server-integration.test.js.map