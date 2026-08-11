"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurationRepository = exports.CURATION_REPOSITORY_API_VERSION = void 0;
const domain_1 = require("../domain");
const paths_1 = require("../security/paths");
exports.CURATION_REPOSITORY_API_VERSION = 5;
const ITEM_SELECT = `
  SELECT id,
         relative_path AS relativePath,
         media_type AS mediaType,
         file_size AS fileSize,
         file_mtime AS fileMtime,
         file_hash AS fileHash,
         hash_algorithm AS hashAlgorithm,
         state,
         current_cycle AS currentCycle,
         created_at AS createdAt,
         updated_at AS updatedAt,
         approved_by_user_id AS approvedByUserId,
         approved_by_user_name AS approvedByUserName,
         approved_at AS approvedAt,
         declined_by_user_id AS declinedByUserId,
         declined_by_user_name AS declinedByUserName,
         declined_at AS declinedAt,
         executed_at AS executedAt,
         execution_error AS executionError
    FROM deletion_items
`;
const REQUEST_SELECT = `
  SELECT id,
         deletion_item_id AS deletionItemId,
         cycle,
         requested_by_user_id AS requestedByUserId,
         requested_by_user_name AS requestedByUserName,
         requested_at AS requestedAt,
         reason,
         withdrawn_at AS withdrawnAt
    FROM deletion_requests
`;
const METADATA_REQUEST_SELECT = `
  SELECT mr.id,
         cm.relative_path AS relativePath,
         mr.category,
         mr.state,
         mr.requested_by_user_id AS requestedByUserId,
         mr.requested_by_user_name AS requestedByUserName,
         mr.requested_at AS requestedAt,
         mr.comment,
         mr.updated_at AS updatedAt,
         mr.closed_by_user_id AS closedByUserId,
         mr.closed_by_user_name AS closedByUserName,
         mr.closed_at AS closedAt,
         mr.resolution_comment AS resolutionComment
    FROM metadata_requests mr
    JOIN curation_media cm ON cm.id = mr.curation_media_id
`;
class CurationRepository {
    constructor(database, reasonMaxLength = 4000, now = () => new Date().toISOString()) {
        this.database = database;
        this.reasonMaxLength = reasonMaxLength;
        this.now = now;
        this.db = database.connection;
    }
    close() {
        this.database.close();
    }
    getItem(relativePathInput) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        return this.db.prepare(`${ITEM_SELECT} WHERE relative_path = ?`).get(relativePath) || null;
    }
    getState(relativePath) {
        return this.getItem(relativePath)?.state || null;
    }
    hasActiveDeletionRequest(relativePathInput, userId) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        return Boolean(this.db.prepare(`
      SELECT 1
        FROM deletion_items di
        JOIN deletion_requests dr ON dr.deletion_item_id = di.id
       WHERE di.relative_path = ?
         AND di.state IN ('PENDING', 'APPROVED', 'ERROR')
         AND dr.cycle = di.current_cycle
         AND dr.requested_by_user_id = ?
         AND dr.withdrawn_at IS NULL
       LIMIT 1
    `).get(relativePath, userId));
    }
    getProjection(relativePath) {
        const normalizedPath = (0, paths_1.normalizeRelativeMediaPath)(relativePath);
        const info = this.getInfo(relativePath);
        const activeDeletion = info && ['PENDING', 'APPROVED', 'ERROR'].includes(info.item.state)
            ? info
            : null;
        const metadataRequests = this.db.prepare(`${METADATA_REQUEST_SELECT} WHERE cm.relative_path = ? AND mr.state = 'OPEN' ORDER BY mr.id`).all(normalizedPath);
        if (!activeDeletion && metadataRequests.length === 0) {
            return null;
        }
        const media = this.db.prepare('SELECT public_token AS publicToken FROM curation_media WHERE relative_path = ?').get(normalizedPath);
        const deletionRequesterNames = [...new Set((activeDeletion?.requests || [])
                .filter(request => request.cycle === activeDeletion?.item.currentCycle && request.withdrawnAt === null)
                .map(request => request.requestedByUserName))];
        return {
            state: activeDeletion?.item.state || null,
            requesterNames: [...new Set([
                    ...deletionRequesterNames,
                    ...metadataRequests.map(request => request.requestedByUserName)
                ])],
            deletionRequesterNames,
            metadataCategories: metadataRequests.map(request => request.category),
            itemToken: media?.publicToken || null
        };
    }
    getInfo(relativePath) {
        const item = this.getItem(relativePath);
        if (!item) {
            return null;
        }
        const requests = this.db.prepare(`${REQUEST_SELECT} WHERE deletion_item_id = ? ORDER BY requested_at, id`).all(item.id);
        return { item, requests };
    }
    requestDeletion(input) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(input.relativePath);
        const reason = this.normalizeReason(input.reason);
        return this.db.transaction(() => {
            const timestamp = this.now();
            this.ensureMedia(relativePath, input.mediaType, timestamp);
            let item = this.getItem(relativePath);
            let status = 'requested';
            if (!item) {
                const result = this.db.prepare(`
          INSERT INTO deletion_items(
            relative_path, media_type, file_size, file_mtime, file_hash, hash_algorithm,
            state, current_cycle, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 1, ?, ?)
        `).run(relativePath, input.mediaType, input.fingerprint.fileSize, input.fingerprint.fileMtime, input.fingerprint.fileHash, input.fingerprint.hashAlgorithm, timestamp, timestamp);
                item = this.itemById(Number(result.lastInsertRowid));
            }
            else if (item.state === 'DECLINED') {
                status = 'reopened';
                this.db.prepare(`
          UPDATE deletion_items
             SET state = 'PENDING', current_cycle = current_cycle + 1,
                 media_type = ?, file_size = ?, file_mtime = ?, file_hash = ?, hash_algorithm = ?,
                 updated_at = ?, approved_by_user_id = NULL, approved_by_user_name = NULL,
                 approved_at = NULL, declined_by_user_id = NULL, declined_by_user_name = NULL,
                 declined_at = NULL, executed_at = NULL, execution_error = NULL
           WHERE id = ?
        `).run(input.mediaType, input.fingerprint.fileSize, input.fingerprint.fileMtime, input.fingerprint.fileHash, input.fingerprint.hashAlgorithm, timestamp, item.id);
                item = this.itemById(item.id);
            }
            else if (item.state !== 'PENDING') {
                throw new Error(`Deletion request cannot be added while item is ${item.state}`);
            }
            const existing = this.db.prepare(`
        SELECT id FROM deletion_requests
         WHERE deletion_item_id = ? AND cycle = ? AND requested_by_user_id = ? AND withdrawn_at IS NULL
      `).get(item.id, item.currentCycle, input.actor.id);
            if (existing) {
                return { status: 'already_requested', item };
            }
            this.db.prepare(`
        INSERT INTO deletion_requests(
          deletion_item_id, cycle, requested_by_user_id, requested_by_user_name, requested_at, reason
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.id, item.currentCycle, input.actor.id, input.actor.name, timestamp, reason);
            this.addEvent(item.id, item.currentCycle, 'REQUESTED', input.actor, timestamp, { reason });
            return { status, item: this.itemById(item.id) };
        })();
    }
    withdrawOwnDeletionRequest(relativePathInput, actor) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        return this.db.transaction(() => {
            const item = this.getItem(relativePath);
            if (!item || !['PENDING', 'APPROVED', 'ERROR'].includes(item.state)) {
                return { status: 'not_requester', item, remainingRequesters: 0 };
            }
            const request = this.db.prepare(`
        SELECT id
          FROM deletion_requests
         WHERE deletion_item_id = ? AND cycle = ?
           AND requested_by_user_id = ? AND withdrawn_at IS NULL
      `).get(item.id, item.currentCycle, actor.id);
            if (!request) {
                const remainingRequesters = this.activeRequesterCount(item.id, item.currentCycle);
                return { status: 'not_requester', item, remainingRequesters };
            }
            const timestamp = this.now();
            this.db.prepare(`
        UPDATE deletion_requests
           SET withdrawn_at = ?
         WHERE id = ? AND withdrawn_at IS NULL
      `).run(timestamp, request.id);
            const remainingRequesters = this.activeRequesterCount(item.id, item.currentCycle);
            this.addEvent(item.id, item.currentCycle, 'REQUEST_WITHDRAWN', actor, timestamp, {
                previousState: item.state,
                remainingRequesters
            });
            if (remainingRequesters === 0) {
                this.db.prepare(`
          UPDATE deletion_items
             SET state = 'DECLINED', updated_at = ?,
                 declined_by_user_id = ?, declined_by_user_name = ?, declined_at = ?,
                 execution_error = NULL
           WHERE id = ? AND current_cycle = ?
             AND state IN ('PENDING', 'APPROVED', 'ERROR')
        `).run(timestamp, actor.id, actor.name, timestamp, item.id, item.currentCycle);
                this.addEvent(item.id, item.currentCycle, 'DELETION_CANCELLED', actor, timestamp, {
                    previousState: item.state
                });
            }
            return {
                status: 'withdrawn',
                item: this.itemById(item.id),
                remainingRequesters
            };
        })();
    }
    requestMetadata(input) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(input.relativePath);
        const categories = [...new Set(input.categories)];
        if (categories.length === 0 || categories.some(category => !domain_1.METADATA_CATEGORIES.includes(category))) {
            throw new Error('At least one valid metadata correction category is required');
        }
        const comment = this.normalizeComment(input.comment);
        return this.db.transaction(() => {
            if (this.hasActiveDeletionRequest(relativePath, input.actor.id)) {
                throw new Error('Metadata corrections cannot be requested while your deletion request is active');
            }
            const timestamp = this.now();
            const mediaId = this.ensureMedia(relativePath, input.mediaType, timestamp);
            const created = [];
            const existing = [];
            for (const category of categories) {
                const active = this.db.prepare(`
          SELECT id FROM metadata_requests
           WHERE curation_media_id = ? AND category = ?
             AND requested_by_user_id = ? AND state = 'OPEN'
        `).get(mediaId, category, input.actor.id);
                if (active) {
                    existing.push(category);
                    continue;
                }
                const inserted = this.db.prepare(`
          INSERT INTO metadata_requests(
            curation_media_id, category, state,
            requested_by_user_id, requested_by_user_name, requested_at,
            comment, updated_at
          ) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?)
        `).run(mediaId, category, input.actor.id, input.actor.name, timestamp, comment, timestamp);
                const requestId = Number(inserted.lastInsertRowid);
                this.addMetadataEvent(requestId, 'REQUESTED', input.actor, timestamp, { category, comment });
                created.push(category);
            }
            return { created, existing };
        })();
    }
    withdrawOwnCurationRequests(relativePathInput, actor) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        return this.db.transaction(() => {
            const deletion = this.withdrawOwnDeletionRequest(relativePath, actor);
            const requests = this.db.prepare(`
        SELECT mr.id
          FROM metadata_requests mr
          JOIN curation_media cm ON cm.id = mr.curation_media_id
         WHERE cm.relative_path = ? AND mr.requested_by_user_id = ? AND mr.state = 'OPEN'
      `).all(relativePath, actor.id);
            const timestamp = this.now();
            for (const request of requests) {
                this.db.prepare(`
          UPDATE metadata_requests
             SET state = 'WITHDRAWN', updated_at = ?,
                 closed_by_user_id = ?, closed_by_user_name = ?, closed_at = ?
           WHERE id = ? AND state = 'OPEN'
        `).run(timestamp, actor.id, actor.name, timestamp, request.id);
                this.addMetadataEvent(request.id, 'WITHDRAWN', actor, timestamp);
            }
            return {
                deletionWithdrawn: deletion.status === 'withdrawn',
                metadataWithdrawn: requests.length
            };
        })();
    }
    closeMetadataRequests(relativePathInput, actor, outcome, resolutionComment) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        const comment = this.normalizeComment(resolutionComment);
        return this.db.transaction(() => {
            const requests = this.db.prepare(`
        SELECT mr.id
          FROM metadata_requests mr
          JOIN curation_media cm ON cm.id = mr.curation_media_id
         WHERE cm.relative_path = ? AND mr.state = 'OPEN'
      `).all(relativePath);
            if (requests.length === 0) {
                throw new Error('This photo has no open metadata correction requests');
            }
            const timestamp = this.now();
            for (const request of requests) {
                this.db.prepare(`
          UPDATE metadata_requests
             SET state = ?, updated_at = ?,
                 closed_by_user_id = ?, closed_by_user_name = ?, closed_at = ?,
                 resolution_comment = ?
           WHERE id = ? AND state = 'OPEN'
        `).run(outcome, timestamp, actor.id, actor.name, timestamp, comment, request.id);
                this.addMetadataEvent(request.id, outcome, actor, timestamp, { comment });
            }
            return requests.length;
        })();
    }
    getClientRequestDetails(itemToken, actor, administrator) {
        if (!/^[a-f0-9]{32}$/.test(itemToken)) {
            return [];
        }
        const media = this.db.prepare('SELECT relative_path AS relativePath FROM curation_media WHERE public_token = ?').get(itemToken);
        if (!media) {
            return [];
        }
        const details = [];
        const deletionInfo = this.getInfo(media.relativePath);
        if (deletionInfo && ['PENDING', 'APPROVED', 'ERROR'].includes(deletionInfo.item.state)) {
            for (const request of deletionInfo.requests) {
                if (request.cycle !== deletionInfo.item.currentCycle || request.withdrawnAt !== null ||
                    (!administrator && request.requestedByUserId !== actor.id)) {
                    continue;
                }
                details.push({
                    kind: 'deletion',
                    category: 'deletion',
                    state: deletionInfo.item.state,
                    requesterName: request.requestedByUserName,
                    requestedAt: request.requestedAt,
                    comment: request.reason,
                    ownRequest: request.requestedByUserId === actor.id
                });
            }
        }
        const metadata = this.db.prepare(`${METADATA_REQUEST_SELECT} WHERE cm.relative_path = ? AND mr.state = 'OPEN' ORDER BY mr.requested_at, mr.id`).all(media.relativePath);
        for (const request of metadata) {
            if (!administrator && request.requestedByUserId !== actor.id) {
                continue;
            }
            details.push({
                kind: 'metadata',
                category: request.category,
                state: request.state,
                requesterName: request.requestedByUserName,
                requestedAt: request.requestedAt,
                comment: request.comment,
                ownRequest: request.requestedByUserId === actor.id
            });
        }
        return details;
    }
    approve(relativePathInput, actor, fingerprint) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        return this.db.transaction(() => {
            const item = this.requireItem(relativePath);
            if (item.state === 'APPROVED') {
                return item;
            }
            if (item.state !== 'PENDING') {
                throw new Error(`Only PENDING items can be approved; current state is ${item.state}`);
            }
            const timestamp = this.now();
            this.db.prepare(`
        UPDATE deletion_items
           SET state = 'APPROVED', file_size = ?, file_mtime = ?, file_hash = ?, hash_algorithm = ?,
               approved_by_user_id = ?, approved_by_user_name = ?, approved_at = ?, updated_at = ?,
               declined_by_user_id = NULL, declined_by_user_name = NULL, declined_at = NULL,
               execution_error = NULL
         WHERE id = ?
      `).run(fingerprint.fileSize, fingerprint.fileMtime, fingerprint.fileHash, fingerprint.hashAlgorithm, actor.id, actor.name, timestamp, timestamp, item.id);
            this.addEvent(item.id, item.currentCycle, 'APPROVED', actor, timestamp);
            return this.itemById(item.id);
        })();
    }
    decline(relativePathInput, actor) {
        const relativePath = (0, paths_1.normalizeRelativeMediaPath)(relativePathInput);
        return this.db.transaction(() => {
            const item = this.requireItem(relativePath);
            if (item.state === 'DECLINED') {
                return item;
            }
            if (!['PENDING', 'APPROVED', 'ERROR'].includes(item.state)) {
                throw new Error(`Only active items can be declined; current state is ${item.state}`);
            }
            const timestamp = this.now();
            this.db.prepare(`
        UPDATE deletion_items
           SET state = 'DECLINED', declined_by_user_id = ?, declined_by_user_name = ?,
               declined_at = ?, updated_at = ?, execution_error = NULL
         WHERE id = ?
      `).run(actor.id, actor.name, timestamp, timestamp, item.id);
            this.addEvent(item.id, item.currentCycle, 'DECLINED', actor, timestamp);
            return this.itemById(item.id);
        })();
    }
    normalizeReason(reason) {
        return this.normalizeComment(reason);
    }
    normalizeComment(comment) {
        if (comment == null) {
            return null;
        }
        const normalized = String(comment).trim();
        if (normalized.length > this.reasonMaxLength) {
            throw new Error(`Curation comment exceeds ${this.reasonMaxLength} characters`);
        }
        return normalized || null;
    }
    ensureMedia(relativePath, mediaType, timestamp) {
        this.db.prepare(`
      INSERT INTO curation_media(relative_path, media_type, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        media_type = excluded.media_type,
        updated_at = excluded.updated_at
    `).run(relativePath, mediaType, timestamp, timestamp);
        const media = this.db.prepare('SELECT id FROM curation_media WHERE relative_path = ?').get(relativePath);
        if (!media) {
            throw new Error(`Curation media record was not created for ${relativePath}`);
        }
        return media.id;
    }
    activeRequesterCount(itemId, cycle) {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count
        FROM deletion_requests
       WHERE deletion_item_id = ? AND cycle = ? AND withdrawn_at IS NULL
    `).get(itemId, cycle);
        return row.count;
    }
    requireItem(relativePath) {
        const item = this.getItem(relativePath);
        if (!item) {
            throw new Error('This photo has no deletion request');
        }
        return item;
    }
    itemById(id) {
        const item = this.db.prepare(`${ITEM_SELECT} WHERE id = ?`).get(id);
        if (!item) {
            throw new Error(`Curation item ${id} was not found`);
        }
        return item;
    }
    addEvent(itemId, cycle, eventType, actor, timestamp, payload) {
        this.db.prepare(`
      INSERT INTO curation_events(
        deletion_item_id, cycle, event_type, actor_user_id, actor_user_name, created_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, cycle, eventType, actor?.id || null, actor?.name || null, timestamp, payload === undefined ? null : JSON.stringify(payload));
    }
    addMetadataEvent(requestId, eventType, actor, timestamp, payload) {
        this.db.prepare(`
      INSERT INTO metadata_request_events(
        metadata_request_id, event_type, actor_user_id, actor_user_name, created_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(requestId, eventType, actor?.id || null, actor?.name || null, timestamp, payload === undefined ? null : JSON.stringify(payload));
    }
}
exports.CurationRepository = CurationRepository;
//# sourceMappingURL=repository.js.map