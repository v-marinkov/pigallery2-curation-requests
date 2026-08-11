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
(0, node_test_1.it)('executes general curation and deletion workflows without changing the photo', async () => {
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
        strict_1.default.deepEqual(albums, [
            '✎ Curation · All open',
            '✎ Curation · Faces',
            '✎ Curation · Tags',
            '✎ Curation · Location',
            '✎ Curation · Date and time',
            '✎ Curation · Title and caption',
            '✎ Curation · Duplicates',
            '✎ Curation · Other',
            '🗑 Deletion requests',
            '✓ Approved for deletion',
            '⚠ Deletion errors'
        ]);
        strict_1.default.equal(buttons.get('Request curation')?.config.minUserRole, UserDTO_1.UserRoles.User);
        strict_1.default.deepEqual(buttons.get('Request curation')?.config.popup.customFields.map((field) => field.id), ['deletion', 'faces', 'tags', 'location', 'dateTime', 'titleCaption', 'duplicate', 'other', 'comment']);
        strict_1.default.deepEqual(buttons.get('Request curation')?.config.popup.customFields
            .filter((field) => field.type === 'boolean')
            .map((field) => field.label), [
            '🗑 Request deletion',
            '👤 Wrong or missing faces',
            '🏷 Wrong or missing tags',
            '📍 Wrong or missing location',
            '🕒 Wrong date or time',
            '📝 Wrong or missing title/caption',
            '🖼 Duplicate photo',
            '❓ Other'
        ]);
        strict_1.default.equal(buttons.get('Cancel my curation requests')?.config.minUserRole, UserDTO_1.UserRoles.User);
        strict_1.default.equal(buttons.get('Resolve metadata requests (admin only)')?.config.minUserRole, UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(buttons.get('Approve deletion (admin only)')?.config.minUserRole, UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(apiRoles.get('Resolve metadata requests (admin only)'), UserDTO_1.UserRoles.Admin);
        strict_1.default.equal(guards.get('request-curation')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.equal(guards.get('approve-deletion')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.equal(jsonRoutes.get('client-permissions')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.equal(jsonRoutes.get('request-details/:token')?.role, UserDTO_1.UserRoles.User);
        strict_1.default.deepEqual(jsonRoutes.get('client-permissions')?.callback(undefined, undefined, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User }), { userId: '1', userName: 'anna', canRequestCuration: true, canModerateCuration: false });
        strict_1.default.deepEqual(jsonRoutes.get('client-permissions')?.callback(undefined, undefined, { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User }), { userId: '2', userName: 'bob', canRequestCuration: false, canModerateCuration: false });
        strict_1.default.deepEqual(jsonRoutes.get('client-permissions')?.callback(undefined, undefined, { id: 9, name: 'site-admin', role: UserDTO_1.UserRoles.Admin }), { userId: '9', userName: 'site-admin', canRequestCuration: true, canModerateCuration: true });
        const deniedResponses = [];
        let guardContinued = false;
        guards.get('approve-deletion').middleware({ session: { context: { user: { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User } } } }, { json: (body) => { deniedResponses.push(body); } }, () => { guardContinued = true; });
        strict_1.default.equal(guardContinued, false);
        strict_1.default.equal(deniedResponses[0].error.code, 4);
        guards.get('request-curation').middleware({
            session: { context: { user: { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User } } },
            body: { data: { customFields: { faces: true } } }
        }, { json: (body) => { deniedResponses.push(body); } }, () => { guardContinued = true; });
        strict_1.default.equal(deniedResponses[1].error.code, 4);
        guards.get('request-curation').middleware({
            session: { context: { user: { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User } } },
            body: { data: { customFields: { comment: 'nothing selected' } } }
        }, { json: (body) => { deniedResponses.push(body); } }, () => { guardContinued = true; });
        strict_1.default.equal(deniedResponses[2].error.code, 50);
        strict_1.default.match(deniedResponses[2].error.message, /Select at least one/);
        await buttons.get('Request curation').callback({}, { data: { customFields: {
                    deletion: true,
                    faces: true,
                    other: true,
                    comment: 'Duplicate and missing people'
                } } }, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        strict_1.default.equal((0, fs_1.readFileSync)(photoPath, 'utf8'), 'photo remains read only');
        strict_1.default.ok(media.metadata.keywords.includes('family'));
        strict_1.default.ok(media.metadata.keywords.includes('pg-curation:delete-pending'));
        strict_1.default.ok(media.metadata.keywords.includes('pg-curation:open'));
        strict_1.default.ok(media.metadata.keywords.includes('pg-curation:category:faces'));
        strict_1.default.ok(media.metadata.keywords.includes('pg-curation:category:other'));
        strict_1.default.ok(media.metadata.keywords.includes('pg-curation:requested-by:anna'));
        const itemTag = media.metadata.keywords.find((keyword) => keyword.startsWith('pg-curation:item:'));
        strict_1.default.match(itemTag || '', /^pg-curation:item:[a-f0-9]{32}$/);
        const token = itemTag.split(':').at(-1);
        const ownerDetails = jsonRoutes.get('request-details/:token')?.callback({ token }, undefined, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User });
        strict_1.default.deepEqual(ownerDetails.requests.map((request) => request.category), [
            'deletion', 'faces', 'other'
        ]);
        const strangerDetails = jsonRoutes.get('request-details/:token')?.callback({ token }, undefined, { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User });
        strict_1.default.deepEqual(strangerDetails, { requests: [] });
        await buttons.get('Resolve metadata requests (admin only)').callback({}, { data: { customFields: { confirm: true } } }, { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        await buttons.get('Approve deletion (admin only)').callback({}, { data: { customFields: { confirm: true } } }, { id: 2, name: 'bob', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        const dbPath = path.join(databaseRoot, 'curation', 'curation.sqlite');
        const database = new better_sqlite3_1.default(dbPath, { readonly: true });
        strict_1.default.deepEqual(database.prepare('SELECT state, requested_by_user_name, reason FROM deletion_items JOIN deletion_requests ON deletion_items.id = deletion_requests.deletion_item_id').get(), { state: 'PENDING', requested_by_user_name: 'anna', reason: 'Duplicate and missing people' });
        strict_1.default.deepEqual(database.prepare('SELECT category, state, comment FROM metadata_requests ORDER BY id').all(), [
            { category: 'faces', state: 'OPEN', comment: 'Duplicate and missing people' },
            { category: 'other', state: 'OPEN', comment: 'Duplicate and missing people' }
        ]);
        database.close();
        await buttons.get('Approve deletion (admin only)').callback({}, { data: { customFields: { confirm: true } } }, { id: 9, name: 'admin', role: UserDTO_1.UserRoles.Admin }, media, mediaRepository);
        await buttons.get('Resolve metadata requests (admin only)').callback({}, { data: { customFields: { confirm: true, resolutionComment: 'XMP fixed' } } }, { id: 9, name: 'admin', role: UserDTO_1.UserRoles.Admin }, media, mediaRepository);
        strict_1.default.ok(media.metadata.keywords.includes('pg-curation:delete-approved'));
        strict_1.default.ok(!media.metadata.keywords.some((keyword) => keyword.startsWith('pg-curation:category:')));
        const reindexed = await metadataAfter({
            input: [photoPath],
            output: { keywords: ['family'], size: { width: 1, height: 1 }, fileSize: 1, creationDate: 0 }
        });
        strict_1.default.ok(reindexed.keywords.includes('pg-curation:delete-approved'));
        await buttons.get('Cancel my curation requests').callback({}, { data: { customFields: { confirm: true } } }, { id: 1, name: 'anna', role: UserDTO_1.UserRoles.User }, media, mediaRepository);
        strict_1.default.deepEqual(media.metadata.keywords, ['family']);
        strict_1.default.equal(saved.length, 4);
        strict_1.default.ok(warnings.some(message => message.includes('blocked unauthorized attempt')));
    }
    finally {
        await (0, server_1.cleanUp)();
        (0, fs_1.rmSync)(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=server-integration.test.js.map