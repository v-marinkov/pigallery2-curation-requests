"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCurationProjection = exports.applyCurationState = exports.stateTag = exports.DELETION_STATES = exports.TAG_REQUESTED_BY_PREFIX = exports.TAG_DELETE_ERROR = exports.TAG_DELETE_APPROVED = exports.TAG_DELETE_PENDING = exports.CURATION_PREFIX = void 0;
exports.CURATION_PREFIX = 'pg-curation:';
exports.TAG_DELETE_PENDING = `${exports.CURATION_PREFIX}delete-pending`;
exports.TAG_DELETE_APPROVED = `${exports.CURATION_PREFIX}delete-approved`;
exports.TAG_DELETE_ERROR = `${exports.CURATION_PREFIX}delete-error`;
exports.TAG_REQUESTED_BY_PREFIX = `${exports.CURATION_PREFIX}requested-by:`;
exports.DELETION_STATES = ['PENDING', 'APPROVED', 'DECLINED', 'EXECUTED', 'ERROR'];
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
const requesterTag = (name) => {
    const safeName = name.replace(/,/g, '‚').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
    return safeName ? `${exports.TAG_REQUESTED_BY_PREFIX}${safeName}` : null;
};
const applyCurationProjection = (keywords, projection) => {
    const result = (keywords || []).filter(keyword => !keyword.startsWith(exports.CURATION_PREFIX));
    const tag = (0, exports.stateTag)(projection?.state);
    if (tag) {
        result.push(tag);
    }
    if (projection && projection.state !== 'DECLINED' && projection.state !== 'EXECUTED') {
        const names = [...new Set(projection.requesterNames.map(name => name.trim()).filter(Boolean))];
        for (const name of names) {
            const requestedByTag = requesterTag(name);
            if (requestedByTag) {
                result.push(requestedByTag);
            }
        }
    }
    return result;
};
exports.applyCurationProjection = applyCurationProjection;
//# sourceMappingURL=domain.js.map