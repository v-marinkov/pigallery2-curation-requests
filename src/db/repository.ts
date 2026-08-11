import Database from 'better-sqlite3';
import {
  Actor,
  CurationProjection,
  CurationItemInfo,
  DeletionItem,
  DeletionRequest,
  DeletionState,
  FileFingerprint,
  RequestDeletionResult,
  WithdrawDeletionRequestResult
} from '../domain';
import {normalizeRelativeMediaPath} from '../security/paths';
import {CurationDatabase} from './database';

export const CURATION_REPOSITORY_API_VERSION = 3;

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

  getProjection(relativePath: string): CurationProjection | null {
    const info = this.getInfo(relativePath);
    if (!info) {
      return null;
    }
    return {
      state: info.item.state,
      requesterNames: info.requests
        .filter(request => request.cycle === info.item.currentCycle && request.withdrawnAt === null)
        .map(request => request.requestedByUserName)
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
    actor: Actor
  ): WithdrawDeletionRequestResult {
    const relativePath = normalizeRelativeMediaPath(relativePathInput);
    return this.db.transaction((): WithdrawDeletionRequestResult => {
      const item = this.getItem(relativePath);
      if (!item || !['PENDING', 'APPROVED', 'ERROR'].includes(item.state)) {
        return {status: 'not_requester', item, remainingRequesters: 0};
      }

      const request = this.db.prepare(`
        SELECT id
          FROM deletion_requests
         WHERE deletion_item_id = ? AND cycle = ?
           AND requested_by_user_id = ? AND withdrawn_at IS NULL
      `).get(item.id, item.currentCycle, actor.id) as {id: number} | undefined;

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
    if (reason == null) {
      return null;
    }
    const normalized = String(reason).trim();
    if (normalized.length > this.reasonMaxLength) {
      throw new Error(`Deletion reason exceeds ${this.reasonMaxLength} characters`);
    }
    return normalized || null;
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
}
