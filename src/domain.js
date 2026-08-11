"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCurationProjection = exports.applyCurationState = exports.stateTag = exports.METADATA_REQUEST_STATES = exports.METADATA_CATEGORIES = exports.DELETION_STATES = exports.TAG_ITEM_PREFIX = exports.TAG_CATEGORY_PREFIX = exports.TAG_CURATION_OPEN = exports.TAG_DELETE_REQUESTED_BY_PREFIX = exports.TAG_REQUESTED_BY_PREFIX = exports.TAG_DELETE_ERROR = exports.TAG_DELETE_APPROVED = exports.TAG_DELETE_PENDING = exports.CURATION_PREFIX = void 0;
exports.CURATION_PREFIX = 'pg-curation:';
exports.TAG_DELETE_PENDING = `${exports.CURATION_PREFIX}delete-pending`;
exports.TAG_DELETE_APPROVED = `${exports.CURATION_PREFIX}delete-approved`;
exports.TAG_DELETE_ERROR = `${exports.CURATION_PREFIX}delete-error`;
exports.TAG_REQUESTED_BY_PREFIX = `${exports.CURATION_PREFIX}requested-by:`;
exports.TAG_DELETE_REQUESTED_BY_PREFIX = `${exports.CURATION_PREFIX}delete-requested-by:`;
exports.TAG_CURATION_OPEN = `${exports.CURATION_PREFIX}open`;
exports.TAG_CATEGORY_PREFIX = `${exports.CURATION_PREFIX}category:`;
exports.TAG_ITEM_PREFIX = `${exports.CURATION_PREFIX}item:`;
exports.DELETION_STATES = ['PENDING', 'APPROVED', 'DECLINED', 'EXECUTED', 'ERROR'];
exports.METADATA_CATEGORIES = [
    'faces',
    'tags',
    'location',
    'date-time',
    'title-caption',
    'duplicate',
    'other'
];
exports.METADATA_REQUEST_STATES = ['OPEN', 'RESOLVED', 'DISMISSED', 'WITHDRAWN'];
const stateTag = (state) => {
    switch (state) {
        case 'PENDING': return exports.TAG_DELETE_PENDING;
        case 'APPROVED': return exports.TAG_DELETE_APPROVED;
        case 'ERROR': return exports.TAG_DELETE_ERROR;
        default: return null;
    }
};
exports.stateTag = stateTag;
const applyCurationState = (keywords, state) => {
    return (0, exports.applyCurationProjection)(keywords, state ? { state, requesterNames: [] } : null);
};
exports.applyCurationState = applyCurationState;
const requesterTag = (prefix, name) => {
    const safeName = name.replace(/,/g, '‚').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
    return safeName ? `${prefix}${safeName}` : null;
};
const applyCurationProjection = (keywords, projection) => {
    const result = (keywords || []).filter(keyword => !keyword.startsWith(exports.CURATION_PREFIX));
    const tag = (0, exports.stateTag)(projection?.state);
    if (tag) {
        result.push(tag);
    }
    const metadataCategories = [...new Set(projection?.metadataCategories || [])];
    const activeDeletion = Boolean(tag);
    if (projection && (activeDeletion || metadataCategories.length > 0)) {
        result.push(exports.TAG_CURATION_OPEN);
        for (const category of metadataCategories) {
            result.push(`${exports.TAG_CATEGORY_PREFIX}${category}`);
        }
        if (projection.itemToken) {
            result.push(`${exports.TAG_ITEM_PREFIX}${projection.itemToken}`);
        }
        const names = [...new Set(projection.requesterNames.map(name => name.trim()).filter(Boolean))];
        for (const name of names) {
            const requestedByTag = requesterTag(exports.TAG_REQUESTED_BY_PREFIX, name);
            if (requestedByTag) {
                result.push(requestedByTag);
            }
        }
        if (activeDeletion) {
            const deletionRequesterNames = [
                ...new Set((projection.deletionRequesterNames || []).map(name => name.trim()).filter(Boolean))
            ];
            for (const name of deletionRequesterNames) {
                const requestedByTag = requesterTag(exports.TAG_DELETE_REQUESTED_BY_PREFIX, name);
                if (requestedByTag) {
                    result.push(requestedByTag);
                }
            }
        }
    }
    return result;
};
exports.applyCurationProjection = applyCurationProjection;
//# sourceMappingURL=domain.js.map