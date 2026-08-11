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
const database_1 = require("../src/db/database");
const repository_1 = require("../src/db/repository");
const domain_1 = require("../src/domain");
const fingerprint_1 = require("../src/security/fingerprint");
const paths_1 = require("../src/security/paths");
const fingerprint = {
    fileSize: 123,
    fileMtime: 456,
    fileHash: 'a'.repeat(64),
    hashAlgorithm: 'sha256'
};
(0, node_test_1.describe)('CurationRepository', () => {
    const tempFolders = [];
    (0, node_test_1.afterEach)(() => {
        for (const folder of tempFolders.splice(0)) {
            (0, fs_1.rmSync)(folder, { recursive: true, force: true });
        }
    });
    const createRepository = () => {
        const folder = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'pg2-curation-test-'));
        tempFolders.push(folder);
        return new repository_1.CurationRepository(new database_1.CurationDatabase(path.join(folder, 'curation.sqlite')), 100, () => '2026-08-10T12:00:00.000Z');
    };
    (0, node_test_1.it)('stores multiple requesters without duplicating the deletion item', () => {
        const repository = createRepository();
        const first = repository.requestDeletion({
            relativePath: '2024/Christmas/IMG_1234.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }, reason: 'duplicate'
        });
        const duplicate = repository.requestDeletion({
            relativePath: '2024/Christmas/IMG_1234.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }, reason: 'clicked twice'
        });
        repository.requestDeletion({
            relativePath: '2024/Christmas/IMG_1234.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '2', name: 'bob' }, reason: 'blurry'
        });
        strict_1.default.equal(first.status, 'requested');
        strict_1.default.equal(duplicate.status, 'already_requested');
        const info = repository.getInfo('2024/Christmas/IMG_1234.jpg');
        strict_1.default.equal(info?.item.state, 'PENDING');
        strict_1.default.equal(info?.requests.length, 2);
        strict_1.default.deepEqual(info?.requests.map(request => request.reason), ['duplicate', 'blurry']);
        const projection = repository.getProjection('2024/Christmas/IMG_1234.jpg');
        strict_1.default.equal(projection?.state, 'PENDING');
        strict_1.default.deepEqual(projection?.requesterNames, ['anna', 'bob']);
        strict_1.default.deepEqual(projection?.deletionRequesterNames, ['anna', 'bob']);
        strict_1.default.deepEqual(projection?.metadataCategories, []);
        strict_1.default.match(projection?.itemToken || '', /^[a-f0-9]{32}$/);
        repository.close();
    });
    (0, node_test_1.it)('approves idempotently and lets an administrator withdraw approval', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }
        });
        const approved = repository.approve('photo.jpg', { id: '9', name: 'admin' }, fingerprint);
        const approvedAgain = repository.approve('photo.jpg', { id: '9', name: 'admin' }, fingerprint);
        strict_1.default.equal(approved.state, 'APPROVED');
        strict_1.default.equal(approved.approvedByUserName, 'admin');
        strict_1.default.equal(approvedAgain.state, 'APPROVED');
        const declined = repository.decline('photo.jpg', { id: '9', name: 'admin' });
        strict_1.default.equal(declined.state, 'DECLINED');
        strict_1.default.equal(declined.declinedByUserName, 'admin');
        repository.close();
    });
    (0, node_test_1.it)('reopens a declined item as a new moderation cycle while preserving history', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }, reason: 'first cycle'
        });
        repository.decline('photo.jpg', { id: '9', name: 'admin' });
        const reopened = repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }, reason: 'second cycle'
        });
        const info = repository.getInfo('photo.jpg');
        strict_1.default.equal(reopened.status, 'reopened');
        strict_1.default.equal(info?.item.currentCycle, 2);
        strict_1.default.equal(info?.requests.length, 2);
        repository.close();
    });
    (0, node_test_1.it)('withdraws only the authenticated requester and cancels when the last requester withdraws', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }, reason: 'anna request'
        });
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '2', name: 'bob' }, reason: 'bob request'
        });
        const forbidden = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '3', name: 'charlie' });
        strict_1.default.equal(forbidden.status, 'not_requester');
        strict_1.default.equal(forbidden.remainingRequesters, 2);
        const first = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '1', name: 'anna' });
        strict_1.default.equal(first.status, 'withdrawn');
        strict_1.default.equal(first.item?.state, 'PENDING');
        strict_1.default.equal(first.remainingRequesters, 1);
        const projection = repository.getProjection('photo.jpg');
        strict_1.default.equal(projection?.state, 'PENDING');
        strict_1.default.deepEqual(projection?.requesterNames, ['bob']);
        strict_1.default.deepEqual(projection?.deletionRequesterNames, ['bob']);
        const duplicate = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '1', name: 'anna' });
        strict_1.default.equal(duplicate.status, 'not_requester');
        strict_1.default.equal(duplicate.remainingRequesters, 1);
        const last = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '2', name: 'bob' });
        strict_1.default.equal(last.status, 'withdrawn');
        strict_1.default.equal(last.item?.state, 'DECLINED');
        strict_1.default.equal(last.item?.declinedByUserName, 'bob');
        strict_1.default.equal(last.remainingRequesters, 0);
        strict_1.default.equal(repository.getProjection('photo.jpg'), null);
        strict_1.default.deepEqual(repository.getInfo('photo.jpg')?.requests.map(request => ({
            name: request.requestedByUserName,
            withdrawn: request.withdrawnAt !== null
        })), [
            { name: 'anna', withdrawn: true },
            { name: 'bob', withdrawn: true }
        ]);
        repository.close();
    });
    (0, node_test_1.it)('removes an approved item from the deletion queue when its sole requester withdraws', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }
        });
        repository.approve('photo.jpg', { id: '9', name: 'admin' }, fingerprint);
        const result = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '1', name: 'anna' });
        strict_1.default.equal(result.status, 'withdrawn');
        strict_1.default.equal(result.item?.state, 'DECLINED');
        strict_1.default.equal(result.item?.approvedByUserName, 'admin');
        strict_1.default.equal(result.remainingRequesters, 0);
        repository.close();
    });
    (0, node_test_1.it)('cancels only the exact owned request while preserving other requesters', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }
        });
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '2', name: 'bob' }
        });
        const deletionRequests = repository.getInfo('photo.jpg').requests;
        const annaDeletion = deletionRequests.find(request => request.requestedByUserId === '1');
        const bobDeletion = deletionRequests.find(request => request.requestedByUserId === '2');
        strict_1.default.equal(repository.withdrawOwnDeletionRequest('photo.jpg', { id: '1', name: 'anna' }, bobDeletion.id).status, 'not_requester');
        repository.approve('photo.jpg', { id: '9', name: 'admin' }, fingerprint);
        const withdrawn = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '1', name: 'anna' }, annaDeletion.id);
        strict_1.default.equal(withdrawn.status, 'withdrawn');
        strict_1.default.equal(withdrawn.item?.state, 'APPROVED');
        strict_1.default.equal(withdrawn.remainingRequesters, 1);
        repository.requestMetadata({
            relativePath: 'metadata.jpg', mediaType: 'photo', categories: ['faces', 'tags'],
            actor: { id: '1', name: 'anna' }
        });
        const details = repository.getClientRequestDetails(repository.getProjection('metadata.jpg').itemToken, { id: '1', name: 'anna' }, false);
        strict_1.default.ok(details.every(detail => Number.isInteger(detail.requestId)));
        const faces = details.find(detail => detail.category === 'faces');
        const tags = details.find(detail => detail.category === 'tags');
        strict_1.default.throws(() => repository.withdrawOwnMetadataRequest('metadata.jpg', tags.requestId, { id: '2', name: 'bob' }), /owned by this user/);
        strict_1.default.equal(repository.withdrawOwnMetadataRequest('metadata.jpg', faces.requestId, { id: '1', name: 'anna' }).state, 'WITHDRAWN');
        strict_1.default.deepEqual(repository.getProjection('metadata.jpg')?.metadataCategories, ['tags']);
        repository.close();
    });
    (0, node_test_1.it)('stores independent metadata categories and exposes comments only to owners or administrators', () => {
        const repository = createRepository();
        const first = repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo',
            categories: ['faces', 'location'], actor: { id: '1', name: 'anna' },
            comment: 'Please identify the grandparents'
        });
        const duplicate = repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo',
            categories: ['faces'], actor: { id: '1', name: 'anna' }, comment: 'duplicate click'
        });
        repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo',
            categories: ['tags'], actor: { id: '2', name: 'bob' }, comment: 'missing holiday tag'
        });
        strict_1.default.deepEqual(first, { created: ['faces', 'location'], existing: [] });
        strict_1.default.deepEqual(duplicate, { created: [], existing: ['faces'] });
        const projection = repository.getProjection('photo.jpg');
        strict_1.default.equal(projection?.state, null);
        strict_1.default.deepEqual(projection?.metadataCategories, ['faces', 'location', 'tags']);
        strict_1.default.deepEqual(projection?.requesterNames, ['anna', 'bob']);
        strict_1.default.deepEqual(projection?.deletionRequesterNames, []);
        strict_1.default.match(projection?.itemToken || '', /^[a-f0-9]{32}$/);
        const ownerDetails = repository.getClientRequestDetails(projection.itemToken, { id: '1', name: 'anna' }, false);
        strict_1.default.deepEqual(ownerDetails.map(detail => detail.category), ['faces', 'location']);
        strict_1.default.ok(ownerDetails.every(detail => detail.ownRequest));
        strict_1.default.ok(ownerDetails.every(detail => Number.isInteger(detail.requestId)));
        strict_1.default.equal(ownerDetails[0].comment, 'Please identify the grandparents');
        strict_1.default.deepEqual(repository.getClientRequestDetails(projection.itemToken, { id: '3', name: 'charlie' }, false), []);
        const adminDetails = repository.getClientRequestDetails(projection.itemToken, { id: '9', name: 'admin' }, true);
        strict_1.default.deepEqual(adminDetails.map(detail => detail.category), ['faces', 'location', 'tags']);
        strict_1.default.ok(adminDetails.every(detail => Number.isInteger(detail.requestId)));
        repository.close();
    });
    (0, node_test_1.it)('approves metadata as outstanding work, then resolves or dismisses it', () => {
        const repository = createRepository();
        repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['faces', 'location'],
            actor: { id: '1', name: 'anna' }
        });
        const projection = repository.getProjection('photo.jpg');
        const details = repository.getClientRequestDetails(projection.itemToken, { id: '9', name: 'admin' }, true);
        const faces = details.find(detail => detail.category === 'faces');
        const location = details.find(detail => detail.category === 'location');
        strict_1.default.equal(repository.closeMetadataRequest('photo.jpg', faces.requestId, { id: '9', name: 'admin' }, 'APPROVED').approvedByUserName, 'admin');
        strict_1.default.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['faces', 'location']);
        const approvedDetails = repository.getClientRequestDetails(projection.itemToken, { id: '9', name: 'admin' }, true);
        strict_1.default.equal(approvedDetails.find(detail => detail.requestId === faces.requestId)?.state, 'APPROVED');
        strict_1.default.equal(repository.closeMetadataRequest('photo.jpg', faces.requestId, { id: '9', name: 'admin' }, 'RESOLVED').state, 'RESOLVED');
        strict_1.default.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['location']);
        strict_1.default.throws(() => repository.closeMetadataRequest('other.jpg', location.requestId, { id: '9', name: 'admin' }, 'DISMISSED'), /no matching open metadata/);
        strict_1.default.equal(repository.closeMetadataRequest('photo.jpg', location.requestId, { id: '9', name: 'admin' }, 'DISMISSED').state, 'DISMISSED');
        strict_1.default.equal(repository.getProjection('photo.jpg'), null);
        repository.close();
    });
    (0, node_test_1.it)('lets an owner cancel approved metadata while hiding it from other users', () => {
        const repository = createRepository();
        repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['tags'],
            actor: { id: '1', name: 'anna' }
        });
        const projection = repository.getProjection('photo.jpg');
        const request = repository.getClientRequestDetails(projection.itemToken, { id: '9', name: 'admin' }, true)[0];
        repository.closeMetadataRequest('photo.jpg', request.requestId, { id: '9', name: 'admin' }, 'APPROVED');
        strict_1.default.equal(repository.getClientRequestDetails(projection.itemToken, { id: '1', name: 'anna' }, false)[0].state, 'APPROVED');
        strict_1.default.throws(() => repository.withdrawOwnMetadataRequest('photo.jpg', request.requestId, { id: '2', name: 'bob' }), /owned by this user/);
        strict_1.default.equal(repository.withdrawOwnMetadataRequest('photo.jpg', request.requestId, { id: '1', name: 'anna' }).state, 'WITHDRAWN');
        strict_1.default.equal(repository.getProjection('photo.jpg'), null);
        repository.close();
    });
    (0, node_test_1.it)('blocks metadata only for the owner of an active deletion request', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }
        });
        strict_1.default.throws(() => repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['faces'],
            actor: { id: '1', name: 'anna' }
        }), /while your deletion request is active/);
        strict_1.default.deepEqual(repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['tags'],
            actor: { id: '2', name: 'bob' }
        }), { created: ['tags'], existing: [] });
        strict_1.default.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['tags']);
        repository.close();
    });
    (0, node_test_1.it)('locks all new curation requests while deletion is approved', () => {
        const repository = createRepository();
        repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '1', name: 'anna' }
        });
        repository.approve('photo.jpg', { id: '9', name: 'admin' }, fingerprint);
        strict_1.default.throws(() => repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['tags'],
            actor: { id: '9', name: 'admin' }
        }), /locked while deletion is approved/);
        strict_1.default.throws(() => repository.requestDeletion({
            relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
            actor: { id: '2', name: 'bob' }
        }), /cannot be added while item is APPROVED/);
        repository.close();
    });
    (0, node_test_1.it)('withdraws only the owners requests and lets administrators resolve what remains', () => {
        const repository = createRepository();
        repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['faces', 'other'],
            actor: { id: '1', name: 'anna' }
        });
        repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['tags'],
            actor: { id: '2', name: 'bob' }
        });
        const withdrawn = repository.withdrawOwnCurationRequests('photo.jpg', { id: '1', name: 'anna' });
        strict_1.default.deepEqual(withdrawn, { deletionWithdrawn: false, metadataWithdrawn: 2 });
        strict_1.default.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['tags']);
        strict_1.default.throws(() => repository.closeMetadataRequests('photo.jpg', { id: '9', name: 'admin' }, 'RESOLVED', 'not approved yet'), /must be approved/);
        strict_1.default.equal(repository.approveMetadataRequests('photo.jpg', { id: '9', name: 'admin' }), 1);
        strict_1.default.equal(repository.getProjection('photo.jpg')?.metadataPending, false);
        strict_1.default.equal(repository.getProjection('photo.jpg')?.metadataApproved, true);
        strict_1.default.equal(repository.closeMetadataRequests('photo.jpg', { id: '9', name: 'admin' }, 'RESOLVED', 'fixed XMP'), 1);
        strict_1.default.equal(repository.getProjection('photo.jpg'), null);
        strict_1.default.throws(() => repository.closeMetadataRequests('photo.jpg', { id: '9', name: 'admin' }, 'DISMISSED'), /no open metadata/);
        repository.close();
    });
    (0, node_test_1.it)('validates metadata categories and comment length on the server', () => {
        const repository = createRepository();
        strict_1.default.throws(() => repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: [],
            actor: { id: '1', name: 'anna' }
        }), /valid metadata correction category/);
        strict_1.default.throws(() => repository.requestMetadata({
            relativePath: 'photo.jpg', mediaType: 'photo', categories: ['other'],
            actor: { id: '1', name: 'anna' }, comment: 'x'.repeat(101)
        }), /comment exceeds 100/);
        strict_1.default.equal(repository.getProjection('photo.jpg'), null);
        repository.close();
    });
});
(0, node_test_1.describe)('security and synthetic metadata', () => {
    (0, node_test_1.it)('rejects absolute and escaping paths', () => {
        strict_1.default.throws(() => (0, paths_1.normalizeRelativeMediaPath)('../../etc/passwd'), /escapes/);
        strict_1.default.throws(() => (0, paths_1.normalizeRelativeMediaPath)('/etc/passwd'), /relative/);
        strict_1.default.throws(() => (0, paths_1.normalizeRelativeMediaPath)('C:\\Windows\\file.jpg'), /relative/);
        strict_1.default.equal((0, paths_1.normalizeRelativeMediaPath)('./2024\\photo.jpg'), '2024/photo.jpg');
    });
    (0, node_test_1.it)('replaces only internal curation tags', () => {
        strict_1.default.deepEqual((0, domain_1.applyCurationState)(['family', 'pg-curation:delete-pending'], 'APPROVED'), ['family', 'pg-curation:delete-approved', 'pg-curation:open']);
        strict_1.default.deepEqual((0, domain_1.applyCurationState)(['family', 'pg-curation:delete-error'], 'DECLINED'), ['family']);
    });
    (0, node_test_1.it)('projects deletion ownership separately from general request ownership', () => {
        strict_1.default.deepEqual((0, domain_1.applyCurationProjection)(['family'], {
            state: 'PENDING',
            requesterNames: ['anna', 'bob'],
            deletionRequesterNames: ['anna'],
            metadataCategories: ['faces']
        }), [
            'family',
            'pg-curation:delete-pending',
            'pg-curation:open',
            'pg-curation:metadata-pending',
            'pg-curation:category:faces',
            'pg-curation:requested-by:anna',
            'pg-curation:requested-by:bob',
            'pg-curation:delete-requested-by:anna'
        ]);
    });
    (0, node_test_1.it)('calculates a SHA-256 fingerprint from a stable file', async () => {
        const folder = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'pg2-fingerprint-test-'));
        const file = path.join(folder, 'photo.jpg');
        (0, fs_1.writeFileSync)(file, 'family photo fixture');
        const result = await (0, fingerprint_1.fingerprintFile)(file);
        strict_1.default.equal(result.hashAlgorithm, 'sha256');
        strict_1.default.equal(result.fileSize, 20);
        strict_1.default.equal(result.fileHash.length, 64);
        (0, fs_1.rmSync)(folder, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('database migrations', () => {
    (0, node_test_1.it)('adds metadata approval tracking to a version-2 database without losing requests', () => {
        const folder = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'pg2-curation-metadata-migration-'));
        const databasePath = path.join(folder, 'curation.sqlite');
        const legacy = new better_sqlite3_1.default(databasePath);
        legacy.exec(`
      CREATE TABLE curation_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO curation_schema_migrations VALUES (1, 'now'), (2, 'now');
      CREATE TABLE metadata_requests (
        id INTEGER PRIMARY KEY, curation_media_id INTEGER NOT NULL,
        category TEXT NOT NULL, state TEXT NOT NULL,
        requested_by_user_id TEXT NOT NULL, requested_by_user_name TEXT NOT NULL,
        requested_at TEXT NOT NULL, comment TEXT, updated_at TEXT NOT NULL,
        closed_by_user_id TEXT, closed_by_user_name TEXT, closed_at TEXT,
        resolution_comment TEXT
      );
      INSERT INTO metadata_requests(
        curation_media_id, category, state, requested_by_user_id,
        requested_by_user_name, requested_at, comment, updated_at
      ) VALUES (1, 'faces', 'OPEN', '1', 'anna', 'now', 'Keep me', 'now');
    `);
        legacy.close();
        const migratedDatabase = new database_1.CurationDatabase(databasePath);
        const row = migratedDatabase.connection.prepare(`
      SELECT id, comment, approved_by_user_id AS approvedByUserId, approved_at AS approvedAt
        FROM metadata_requests
    `).get();
        strict_1.default.deepEqual(row, { id: 1, comment: 'Keep me', approvedByUserId: null, approvedAt: null });
        migratedDatabase.close();
        (0, fs_1.rmSync)(folder, { recursive: true, force: true });
    });
    (0, node_test_1.it)('upgrades a version-1 deletion database without losing its queue', () => {
        const folder = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'pg2-curation-migration-'));
        const databasePath = path.join(folder, 'curation.sqlite');
        const legacy = new better_sqlite3_1.default(databasePath);
        legacy.exec(`
      CREATE TABLE curation_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO curation_schema_migrations VALUES (1, '2026-08-10T00:00:00.000Z');
      CREATE TABLE deletion_items (
        id INTEGER PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, media_type TEXT,
        file_size INTEGER, file_mtime INTEGER, file_hash TEXT, hash_algorithm TEXT,
        state TEXT NOT NULL, current_cycle INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        approved_by_user_id TEXT, approved_by_user_name TEXT, approved_at TEXT,
        declined_by_user_id TEXT, declined_by_user_name TEXT, declined_at TEXT,
        executed_at TEXT, execution_error TEXT
      );
      CREATE TABLE deletion_requests (
        id INTEGER PRIMARY KEY, deletion_item_id INTEGER NOT NULL, cycle INTEGER NOT NULL,
        requested_by_user_id TEXT NOT NULL, requested_by_user_name TEXT NOT NULL,
        requested_at TEXT NOT NULL, reason TEXT, withdrawn_at TEXT
      );
      CREATE TABLE curation_events (
        id INTEGER PRIMARY KEY, deletion_item_id INTEGER NOT NULL, cycle INTEGER NOT NULL,
        event_type TEXT NOT NULL, actor_user_id TEXT, actor_user_name TEXT,
        created_at TEXT NOT NULL, payload_json TEXT
      );
      INSERT INTO deletion_items(
        relative_path, media_type, state, current_cycle, created_at, updated_at
      ) VALUES ('legacy.jpg', 'photo', 'PENDING', 1, 'now', 'now');
      INSERT INTO deletion_requests(
        deletion_item_id, cycle, requested_by_user_id, requested_by_user_name, requested_at
      ) VALUES (1, 1, '1', 'anna', 'now');
    `);
        legacy.close();
        const repository = new repository_1.CurationRepository(new database_1.CurationDatabase(databasePath));
        const projection = repository.getProjection('legacy.jpg');
        strict_1.default.equal(projection?.state, 'PENDING');
        strict_1.default.deepEqual(projection?.requesterNames, ['anna']);
        strict_1.default.match(projection?.itemToken || '', /^[a-f0-9]{32}$/);
        const migrated = new better_sqlite3_1.default(databasePath);
        const columns = migrated.prepare('PRAGMA table_info(metadata_requests)').all();
        strict_1.default.ok(columns.some(column => column.name === 'approved_at'));
        migrated.close();
        repository.close();
        (0, fs_1.rmSync)(folder, { recursive: true, force: true });
    });
});
//# sourceMappingURL=repository.test.js.map