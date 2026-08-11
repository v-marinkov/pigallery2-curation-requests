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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSavedSearches = exports.saveCurationProjection = exports.relativePathFromLoader = exports.getMediaPaths = exports.addMediaButtonWithApiRole = void 0;
const path = __importStar(require("path"));
const SearchQueryDTO_1 = require("../../node_modules/pigallery2-extension-kit/lib/common/entities/SearchQueryDTO");
const domain_1 = require("../domain");
const paths_1 = require("../security/paths");
/**
 * PiGallery2 3.5.x logs a user out when an extension endpoint protected with
 * Admin returns its authorization response, while also failing to hide the
 * button. Keep the intended UI role on the DTO, authenticate as User at the
 * route, and let the callback enforce Admin before doing any work.
 *
 * Private PiGallery2 UI access is intentionally isolated in this adapter.
 */
const addMediaButtonWithApiRole = (extension, buttonConfig, apiRole, callback) => {
    if (!buttonConfig.apiPath) {
        throw new Error(`Media button ${buttonConfig.name} requires an API path`);
    }
    const internalUI = extension.ui;
    if (!Array.isArray(internalUI.buttonConfigs)) {
        throw new Error('Unsupported PiGallery2 UI extension implementation: buttonConfigs is unavailable');
    }
    internalUI.buttonConfigs.push(buttonConfig);
    extension.RESTApi.post.mediaJsonResponse([buttonConfig.apiPath], apiRole, !buttonConfig.skipDirectoryInvalidation, callback);
};
exports.addMediaButtonWithApiRole = addMediaButtonWithApiRole;
const getMediaPaths = (extension, media) => {
    const relativePath = (0, paths_1.normalizeRelativeMediaPath)(path.join(media.directory.path || '', media.directory.name || '', media.name));
    return {
        relativePath,
        absolutePath: path.resolve(extension.paths.ImageFolder, ...relativePath.split('/'))
    };
};
exports.getMediaPaths = getMediaPaths;
const relativePathFromLoader = (extension, absolutePath) => {
    const relative = path.relative(extension.paths.ImageFolder, absolutePath);
    try {
        return (0, paths_1.normalizeRelativeMediaPath)(relative);
    }
    catch {
        return null;
    }
};
exports.relativePathFromLoader = relativePathFromLoader;
const saveCurationProjection = async (media, repository, projection) => {
    media.metadata.keywords = (0, domain_1.applyCurationProjection)(media.metadata.keywords, projection);
    await repository.save(media);
};
exports.saveCurationProjection = saveCurationProjection;
const ensureSavedSearches = async (extension) => {
    const searches = [
        { name: '🗑 Deletion requests', keyword: 'pg-curation:delete-pending' },
        { name: '✓ Approved for deletion', keyword: 'pg-curation:delete-approved' },
        { name: '⚠ Deletion errors', keyword: 'pg-curation:delete-error' }
    ];
    for (const search of searches) {
        await extension._app.objectManagers.AlbumManager.addIfNotExistSavedSearch(search.name, {
            type: SearchQueryDTO_1.SearchQueryTypes.keyword,
            value: search.keyword,
            matchType: SearchQueryDTO_1.TextSearchQueryMatchTypes.exact_match
        }, true);
    }
};
exports.ensureSavedSearches = ensureSavedSearches;
//# sourceMappingURL=adapter.js.map