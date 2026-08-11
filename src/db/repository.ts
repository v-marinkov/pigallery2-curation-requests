import Database from 'better-sqlite3';
import {
  Actor,
  ClientRequestDetail,
  CurationProjection,
  CurationItemInfo,
  DeletionItem,
  DeletionRequest,
  DeletionState,
  FileFingerprint,
  METADATA_CATEGORIES,
  MetadataCategory,
  MetadataRequest,
  RequestDeletionResult,
  WithdrawDeletionRequestResult
} from '../domain';
import {normalizeRelativeMediaPath} from '../security/paths';
import {CurationDatabase} from './database';

export const CURATION_REPOSITORY_API_VERSION = 8;

type ItemRow = {
  id: number;
  relativePath: string;
  mediaType: string | null;
  fileSize: number | null;
  fileMtime: number | null;
  fileHash: string | null;
  hashAlgorithm: string | null;
  state: DeletionState;
  currentCycle: number;
  createdAt: string;
  updatedAt: string;
  approvedByUserId: string | null;
  approvedByUserName: string | null;
  approvedAt: string | null;
  declinedByUserId: string | null;
  declinedByUserName: string | null;
  declinedAt: string | null;
  executedAt: string | null;
  executionError: string | null;
};

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
         mr.approved_by_user_id AS approvedByUserId,
         mr.approved_by_user_name AS approvedByUserName,
         mr.approved_at AS approvedAt,
         mr.closed_by_user_id AS closedByUserId,
         mr.closed_by_user_name AS closedByUserName,
         mr.closed_at AS closedAt,
         mr.resolution_comment AS resolutionComment
    FROM metadata_requests mr
    JOIN curation_media cm ON cm.id = mr.curation_media_id
`;

export class CurationRepository {
  private readonly db: Database.Database;

  constructor(
    private readonly database: CurationDatabase,
    private readonly reasonMaxLength = 4000,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.db = database.connection;
  }

  close(): void {
    this.database.close();
  }

  getItem(relativePathInput: string): DeletionItem | null {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    return (this.db.prepare(`${ITEM_SELECT} WHERE relative_path = ?`).get(relativePath) as ItemRow | undefined) || null;
  }

  getState(relativePath: string): DeletionState | null {
    return this.getItem(relativePath)?.state || null;
  }

  hasActiveDeletionRequest(relativePathInput: string, userId: string): boolean {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
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

  getProjection(relativePath: string): CurationProjection | null {
    const normalizedPath = normalizeRelativeMediaPath(relativePath);
    const info = this.getInfo(relativePath);
    const activeDeletion = info && ['PENDING', 'APPROVED', 'ERROR'].includes(info.item.state)
      ? info
      : null;
    const metadataRequests = this.db.prepare(
      `${METADATA_REQUEST_SELECT} WHERE cm.relative_path = ? AND mr.state = 'OPEN' ORDER BY mr.id`
    ).all(normalizedPath) as MetadataRequest[];
    if (!activeDeletion && metadataRequests.length === 0) {
      return null;
    }
    const media = this.db.prepare(
      'SELECT public_token AS publicToken FROM curation_media WHERE relative_path = ?'
    ).get(normalizedPath) as {publicToken: string} | undefined;
    const deletionRequesterNames = [...new Set(
      (activeDeletion?.requests || [])
        .filter(request => request.cycle === activeDeletion?.item.currentCycle && request.withdrawnAt === null)
        .map(request => request.requestedByUserName)
    )];
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

  getInfo(relativePath: string): CurationItemInfo | null {
    const item = this.getItem(relativePath);
    if (!item) {
      return null;
    }
    const requests = this.db.prepare(
      `${REQUEST_SELECT} WHERE deletion_item_id = ? ORDER BY requested_at, id`
    ).all(item.id) as DeletionRequest[];
    return {item, requests};
  }

  requestDeletion(input: {
    relativePath: string;
    mediaType: string;
    fingerprint: FileFingerprint;
    actor: Actor;
    reason?: string | null;
  }): RequestDeletionResult {
    const relativePath = normalizeRelativeMediaPath(input.relativePath);
    const reason = this.normalizeReason(input.reason);
    return this.db.transaction((): RequestDeletionResult => {
      const timestamp = this.now();
      this.ensureMedia(relativePath, input.mediaType, timestamp);
      let item = this.getItem(relativePath);
      let status: RequestDeletionResult['status'] = 'requested';

      if (!item) {
        const result = this.db.prepare(`
          INSERT INTO deletion_items(
            relative_path, media_type, file_size, file_mtime, file_hash, hash_algorithm,
            state, current_cycle, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 1, ?, ?)
        `).run(
          relativePath, input.mediaType, input.fingerprint.fileSize, input.fingerprint.fileMtime,
          input.fingerprint.fileHash, input.fingerprint.hashAlgorithm, timestamp, timestamp
        );
        item = this.itemById(Number(result.lastInsertRowid));
      } else if (item.state === 'DECLINED') {
        status = 'reopened';
        this.db.prepare(`
          UPDATE deletion_items
             SET state = 'PENDING', current_cycle = current_cycle + 1,
                 media_type = ?, file_size = ?, file_mtime = ?, file_hash = ?, hash_algorithm = ?,
                 updated_at = ?, approved_by_user_id = NULL, approved_by_user_name = NULL,
                 approved_at = NULL, declined_by_user_id = NULL, declined_by_user_name = NULL,
                 declined_at = NULL, executed_at = NULL, execution_error = NULL
           WHERE id = ?
        `).run(
          input.mediaType, input.fingerprint.fileSize, input.fingerprint.fileMtime,
          input.fingerprint.fileHash, input.fingerprint.hashAlgorithm, timestamp, item.id
        );
        item = this.itemById(item.id);
      } else if (item.state !== 'PENDING') {
        throw new Error(`Deletion request cannot be added while item is ${item.state}`);
      }

      const existing = this.db.prepare(`
        SELECT id FROM deletion_requests
         WHERE deletion_item_id = ? AND cycle = ? AND requested_by_user_id = ? AND withdrawn_at IS NULL
      `).get(item.id, item.currentCycle, input.actor.id) as {id: number} | undefined;

      if (existing) {
        return {status: 'already_requested', item};
      }

      this.db.prepare(`
        INSERT INTO deletion_requests(
          deletion_item_id, cycle, requested_by_user_id, requested_by_user_name, requested_at, reason
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.id, item.currentCycle, input.actor.id, input.actor.name, timestamp, reason);
      this.addEvent(item.id, item.currentCycle, 'REQUESTED', input.actor, timestamp, {reason});
      return {status, item: this.itemById(item.id)};
    })();
  }

  withdrawOwnDeletionRequest(
    relativePathInput: string,
    actor: Actor,
    requestId?: number
  ): WithdrawDeletionRequestResult {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    if (requestId !== undefined && (!Number.isInteger(requestId) || requestId <= 0)) {
      throw new Error('A valid deletion request ID is required');
    }
    return this.db.transaction((): WithdrawDeletionRequestResult => {
      const item = this.getItem(relativePath);
      if (!item || !['PENDING', 'APPROVED', 'ERROR'].includes(item.state)) {
        return {status: 'not_requester', item, remainingRequesters: 0};
      }

      const request = requestId === undefined
        ? this.db.prepare(`
            SELECT id
              FROM deletion_requests
             WHERE deletion_item_id = ? AND cycle = ?
               AND requested_by_user_id = ? AND withdrawn_at IS NULL
          `).get(item.id, item.currentCycle, actor.id) as {id: number} | undefined
        : this.db.prepare(`
            SELECT id
              FROM deletion_requests
             WHERE id = ? AND deletion_item_id = ? AND cycle = ?
               AND requested_by_user_id = ? AND withdrawn_at IS NULL
          `).get(requestId, item.id, item.currentCycle, actor.id) as {id: number} | undefined;

      if (!request) {
        const remainingRequesters = this.activeRequesterCount(item.id, item.currentCycle);
        return {status: 'not_requester', item, remainingRequesters};
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

  requestMetadata(input: {
    relativePath: string;
    mediaType: string;
    categories: MetadataCategory[];
    actor: Actor;
    comment?: string | null;
  }): {created: MetadataCategory[]; existing: MetadataCategory[]} {
    const relativePath = normalizeRelativeMediaPath(input.relativePath);
    const categories = [...new Set(input.categories)];
    if (categories.length === 0 || categories.some(category => !METADATA_CATEGORIES.includes(category))) {
      throw new Error('At least one valid metadata correction category is required');
    }
    const comment = this.normalizeComment(input.comment);
    return this.db.transaction(() => {
      if (this.hasActiveDeletionRequest(relativePath, input.actor.id)) {
        throw new Error('Metadata corrections cannot be requested while your deletion request is active');
      }
      const timestamp = this.now();
      const mediaId = this.ensureMedia(relativePath, input.mediaType, timestamp);
      const created: MetadataCategory[] = [];
      const existing: MetadataCategory[] = [];
      for (const category of categories) {
        const active = this.db.prepare(`
          SELECT id FROM metadata_requests
           WHERE curation_media_id = ? AND category = ?
             AND requested_by_user_id = ? AND state = 'OPEN'
        `).get(mediaId, category, input.actor.id) as {id: number} | undefined;
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
        `).run(
          mediaId, category, input.actor.id, input.actor.name,
          timestamp, comment, timestamp
        );
        const requestId = Number(inserted.lastInsertRowid);
        this.addMetadataEvent(requestId, 'REQUESTED', input.actor, timestamp, {category, comment});
        created.push(category);
      }
      return {created, existing};
    })();
  }

  withdrawOwnMetadataRequest(
    relativePathInput: string,
    requestId: number,
    actor: Actor
  ): MetadataRequest {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new Error('A valid metadata request ID is required');
    }
    return this.db.transaction(() => {
      const request = this.db.prepare(`
        ${METADATA_REQUEST_SELECT}
         WHERE mr.id = ? AND cm.relative_path = ?
           AND mr.requested_by_user_id = ? AND mr.state = 'OPEN'
      `).get(requestId, relativePath, actor.id) as MetadataRequest | undefined;
      if (!request) {
        throw new Error('This photo has no matching active metadata request owned by this user');
      }
      const timestamp = this.now();
      this.db.prepare(`
        UPDATE metadata_requests
           SET state = 'WITHDRAWN', updated_at = ?,
               closed_by_user_id = ?, closed_by_user_name = ?, closed_at = ?
         WHERE id = ? AND requested_by_user_id = ? AND state = 'OPEN'
      `).run(timestamp, actor.id, actor.name, timestamp, requestId, actor.id);
      this.addMetadataEvent(requestId, 'WITHDRAWN', actor, timestamp, {granular: true});
      return this.db.prepare(`${METADATA_REQUEST_SELECT} WHERE mr.id = ?`).get(requestId) as MetadataRequest;
    })();
  }

  withdrawOwnCurationRequests(
    relativePathInput: string,
    actor: Actor
  ): {deletionWithdrawn: boolean; metadataWithdrawn: number} {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    return this.db.transaction(() => {
      const deletion = this.withdrawOwnDeletionRequest(relativePath, actor);
      const requests = this.db.prepare(`
        SELECT mr.id
          FROM metadata_requests mr
          JOIN curation_media cm ON cm.id = mr.curation_media_id
         WHERE cm.relative_path = ? AND mr.requested_by_user_id = ? AND mr.state = 'OPEN'
      `).all(relativePath, actor.id) as Array<{id: number}>;
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

  closeMetadataRequests(
    relativePathInput: string,
    actor: Actor,
    outcome: 'RESOLVED' | 'DISMISSED',
    resolutionComment?: string | null
  ): number {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    const comment = this.normalizeComment(resolutionComment);
    return this.db.transaction(() => {
      const requests = this.db.prepare(`
        SELECT mr.id
          FROM metadata_requests mr
          JOIN curation_media cm ON cm.id = mr.curation_media_id
         WHERE cm.relative_path = ? AND mr.state = 'OPEN'
      `).all(relativePath) as Array<{id: number}>;
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
        this.addMetadataEvent(request.id, outcome, actor, timestamp, {comment});
      }
      return requests.length;
    })();
  }

  closeMetadataRequest(
    relativePathInput: string,
    requestId: number,
    actor: Actor,
    outcome: 'APPROVED' | 'RESOLVED' | 'DISMISSED',
    resolutionComment?: string | null
  ): MetadataRequest {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new Error('A valid metadata request ID is required');
    }
    if (!['APPROVED', 'RESOLVED', 'DISMISSED'].includes(outcome)) {
      throw new Error('Metadata request outcome must be APPROVED, RESOLVED, or DISMISSED');
    }
    const comment = this.normalizeComment(resolutionComment);
    return this.db.transaction(() => {
      const request = this.db.prepare(`
        ${METADATA_REQUEST_SELECT}
         WHERE mr.id = ? AND cm.relative_path = ? AND mr.state = 'OPEN'
      `).get(requestId, relativePath) as MetadataRequest | undefined;
      if (!request) {
        throw new Error('This photo has no matching open metadata correction request');
      }
      const timestamp = this.now();
      if (outcome === 'APPROVED') {
        if (request.approvedAt !== null) {
          throw new Error('This metadata correction request is already approved');
        }
        this.db.prepare(`
          UPDATE metadata_requests
             SET updated_at = ?, approved_by_user_id = ?,
                 approved_by_user_name = ?, approved_at = ?
           WHERE id = ? AND state = 'OPEN' AND approved_at IS NULL
        `).run(timestamp, actor.id, actor.name, timestamp, requestId);
        this.addMetadataEvent(requestId, 'APPROVED', actor, timestamp, {comment, granular: true});
        return this.db.prepare(`${METADATA_REQUEST_SELECT} WHERE mr.id = ?`).get(requestId) as MetadataRequest;
      }
      if (outcome === 'RESOLVED' && request.approvedAt === null) {
        throw new Error('Only approved metadata correction requests can be marked done individually');
      }
      this.db.prepare(`
        UPDATE metadata_requests
           SET state = ?, updated_at = ?,
               closed_by_user_id = ?, closed_by_user_name = ?, closed_at = ?,
               resolution_comment = ?
         WHERE id = ? AND state = 'OPEN'
      `).run(outcome, timestamp, actor.id, actor.name, timestamp, comment, requestId);
      this.addMetadataEvent(requestId, outcome, actor, timestamp, {comment, granular: true});
      return this.db.prepare(`${METADATA_REQUEST_SELECT} WHERE mr.id = ?`).get(requestId) as MetadataRequest;
    })();
  }

  getRelativePathForToken(itemToken: string): string | null {
    if (!/^[a-f0-9]{32}$/.test(itemToken)) {
      return null;
    }
    const media = this.db.prepare(
      'SELECT relative_path AS relativePath FROM curation_media WHERE public_token = ?'
    ).get(itemToken) as {relativePath: string} | undefined;
    return media?.relativePath || null;
  }

  getClientRequestDetails(
    itemToken: string,
    actor: Actor,
    administrator: boolean
  ): ClientRequestDetail[] {
    if (!/^[a-f0-9]{32}$/.test(itemToken)) {
      return [];
    }
    const relativePath = this.getRelativePathForToken(itemToken);
    if (!relativePath) {
      return [];
    }
    const details: ClientRequestDetail[] = [];
    const deletionInfo = this.getInfo(relativePath);
    if (deletionInfo && ['PENDING', 'APPROVED', 'ERROR'].includes(deletionInfo.item.state)) {
      for (const request of deletionInfo.requests) {
        if (
          request.cycle !== deletionInfo.item.currentCycle || request.withdrawnAt !== null ||
          (!administrator && request.requestedByUserId !== actor.id)
        ) {
          continue;
        }
        details.push({
          requestId: request.id,
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
    const metadata = this.db.prepare(
      `${METADATA_REQUEST_SELECT} WHERE cm.relative_path = ? AND mr.state = 'OPEN' ORDER BY mr.requested_at, mr.id`
    ).all(relativePath) as MetadataRequest[];
    for (const request of metadata) {
      if (!administrator && request.requestedByUserId !== actor.id) {
        continue;
      }
      details.push({
        requestId: request.id,
        kind: 'metadata',
        category: request.category,
        state: request.state === 'OPEN' && request.approvedAt !== null ? 'APPROVED' : request.state,
        requesterName: request.requestedByUserName,
        requestedAt: request.requestedAt,
        comment: request.comment,
        ownRequest: request.requestedByUserId === actor.id
      });
    }
    return details;
  }

  approve(relativePathInput: string, actor: Actor, fingerprint: FileFingerprint): DeletionItem {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
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
      `).run(
        fingerprint.fileSize, fingerprint.fileMtime, fingerprint.fileHash, fingerprint.hashAlgorithm,
        actor.id, actor.name, timestamp, timestamp, item.id
      );
      this.addEvent(item.id, item.currentCycle, 'APPROVED', actor, timestamp);
      return this.itemById(item.id);
    })();
  }

  decline(relativePathInput: string, actor: Actor): DeletionItem {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
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

  private normalizeReason(reason: string | null | undefined): string | null {
    return this.normalizeComment(reason);
  }

  private normalizeComment(comment: string | null | undefined): string | null {
    if (comment == null) {
      return null;
    }
    const normalized = String(comment).trim();
    if (normalized.length > this.reasonMaxLength) {
      throw new Error(`Curation comment exceeds ${this.reasonMaxLength} characters`);
    }
    return normalized || null;
  }

  private ensureMedia(relativePath: string, mediaType: string, timestamp: string): number {
    this.db.prepare(`
      INSERT INTO curation_media(relative_path, media_type, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        media_type = excluded.media_type,
        updated_at = excluded.updated_at
    `).run(relativePath, mediaType, timestamp, timestamp);
    const media = this.db.prepare(
      'SELECT id FROM curation_media WHERE relative_path = ?'
    ).get(relativePath) as {id: number} | undefined;
    if (!media) {
      throw new Error(`Curation media record was not created for ${relativePath}`);
    }
    return media.id;
  }

  private activeRequesterCount(itemId: number, cycle: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
        FROM deletion_requests
       WHERE deletion_item_id = ? AND cycle = ? AND withdrawn_at IS NULL
    `).get(itemId, cycle) as {count: number};
    return row.count;
  }

  private requireItem(relativePath: string): DeletionItem {
    const item = this.getItem(relativePath);
    if (!item) {
      throw new Error('This photo has no deletion request');
    }
    return item;
  }

  private itemById(id: number): DeletionItem {
    const item = this.db.prepare(`${ITEM_SELECT} WHERE id = ?`).get(id) as ItemRow | undefined;
    if (!item) {
      throw new Error(`Curation item ${id} was not found`);
    }
    return item;
  }

  private addEvent(
    itemId: number,
    cycle: number,
    eventType: string,
    actor: Actor | null,
    timestamp: string,
    payload?: unknown
  ): void {
    this.db.prepare(`
      INSERT INTO curation_events(
        deletion_item_id, cycle, event_type, actor_user_id, actor_user_name, created_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId, cycle, eventType, actor?.id || null, actor?.name || null, timestamp,
      payload === undefined ? null : JSON.stringify(payload)
    );
  }

  private addMetadataEvent(
    requestId: number,
    eventType: string,
    actor: Actor | null,
    timestamp: string,
    payload?: unknown
  ): void {
    this.db.prepare(`
      INSERT INTO metadata_request_events(
        metadata_request_id, event_type, actor_user_id, actor_user_name, created_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      requestId, eventType, actor?.id || null, actor?.name || null, timestamp,
      payload === undefined ? null : JSON.stringify(payload)
    );
  }
}
