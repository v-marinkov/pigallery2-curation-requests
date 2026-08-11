import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {CurationDatabase} from '../src/db/database';
import {CurationRepository} from '../src/db/repository';
import {FileFingerprint, applyCurationProjection, applyCurationState} from '../src/domain';
import {fingerprintFile} from '../src/security/fingerprint';
import {normalizeRelativeMediaPath} from '../src/security/paths';

const fingerprint: FileFingerprint = {
  fileSize: 123,
  fileMtime: 456,
  fileHash: 'a'.repeat(64),
  hashAlgorithm: 'sha256'
};

describe('CurationRepository', () => {
  const tempFolders: string[] = [];

  afterEach(() => {
    for (const folder of tempFolders.splice(0)) {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  const createRepository = (): CurationRepository => {
    const folder = mkdtempSync(path.join(tmpdir(), 'pg2-curation-test-'));
    tempFolders.push(folder);
    return new CurationRepository(
      new CurationDatabase(path.join(folder, 'curation.sqlite')),
      100,
      () => '2026-08-10T12:00:00.000Z'
    );
  };

  it('stores multiple requesters without duplicating the deletion item', () => {
    const repository = createRepository();
    const first = repository.requestDeletion({
      relativePath: '2024/Christmas/IMG_1234.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}, reason: 'duplicate'
    });
    const duplicate = repository.requestDeletion({
      relativePath: '2024/Christmas/IMG_1234.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}, reason: 'clicked twice'
    });
    repository.requestDeletion({
      relativePath: '2024/Christmas/IMG_1234.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '2', name: 'bob'}, reason: 'blurry'
    });

    assert.equal(first.status, 'requested');
    assert.equal(duplicate.status, 'already_requested');
    const info = repository.getInfo('2024/Christmas/IMG_1234.jpg');
    assert.equal(info?.item.state, 'PENDING');
    assert.equal(info?.requests.length, 2);
    assert.deepEqual(info?.requests.map(request => request.reason), ['duplicate', 'blurry']);
    const projection = repository.getProjection('2024/Christmas/IMG_1234.jpg');
    assert.equal(projection?.state, 'PENDING');
    assert.deepEqual(projection?.requesterNames, ['anna', 'bob']);
    assert.deepEqual(projection?.deletionRequesterNames, ['anna', 'bob']);
    assert.deepEqual(projection?.metadataCategories, []);
    assert.match(projection?.itemToken || '', /^[a-f0-9]{32}$/);
    repository.close();
  });

  it('approves idempotently and lets an administrator withdraw approval', () => {
    const repository = createRepository();
    repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}
    });
    const approved = repository.approve('photo.jpg', {id: '9', name: 'admin'}, fingerprint);
    const approvedAgain = repository.approve('photo.jpg', {id: '9', name: 'admin'}, fingerprint);
    assert.equal(approved.state, 'APPROVED');
    assert.equal(approved.approvedByUserName, 'admin');
    assert.equal(approvedAgain.state, 'APPROVED');
    const declined = repository.decline('photo.jpg', {id: '9', name: 'admin'});
    assert.equal(declined.state, 'DECLINED');
    assert.equal(declined.declinedByUserName, 'admin');
    repository.close();
  });

  it('reopens a declined item as a new moderation cycle while preserving history', () => {
    const repository = createRepository();
    repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}, reason: 'first cycle'
    });
    repository.decline('photo.jpg', {id: '9', name: 'admin'});
    const reopened = repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}, reason: 'second cycle'
    });
    const info = repository.getInfo('photo.jpg');
    assert.equal(reopened.status, 'reopened');
    assert.equal(info?.item.currentCycle, 2);
    assert.equal(info?.requests.length, 2);
    repository.close();
  });

  it('withdraws only the authenticated requester and cancels when the last requester withdraws', () => {
    const repository = createRepository();
    repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}, reason: 'anna request'
    });
    repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '2', name: 'bob'}, reason: 'bob request'
    });

    const forbidden = repository.withdrawOwnDeletionRequest(
      'photo.jpg', {id: '3', name: 'charlie'}
    );
    assert.equal(forbidden.status, 'not_requester');
    assert.equal(forbidden.remainingRequesters, 2);

    const first = repository.withdrawOwnDeletionRequest(
      'photo.jpg', {id: '1', name: 'anna'}
    );
    assert.equal(first.status, 'withdrawn');
    assert.equal(first.item?.state, 'PENDING');
    assert.equal(first.remainingRequesters, 1);
    const projection = repository.getProjection('photo.jpg');
    assert.equal(projection?.state, 'PENDING');
    assert.deepEqual(projection?.requesterNames, ['bob']);
    assert.deepEqual(projection?.deletionRequesterNames, ['bob']);

    const duplicate = repository.withdrawOwnDeletionRequest(
      'photo.jpg', {id: '1', name: 'anna'}
    );
    assert.equal(duplicate.status, 'not_requester');
    assert.equal(duplicate.remainingRequesters, 1);

    const last = repository.withdrawOwnDeletionRequest(
      'photo.jpg', {id: '2', name: 'bob'}
    );
    assert.equal(last.status, 'withdrawn');
    assert.equal(last.item?.state, 'DECLINED');
    assert.equal(last.item?.declinedByUserName, 'bob');
    assert.equal(last.remainingRequesters, 0);
    assert.equal(repository.getProjection('photo.jpg'), null);
    assert.deepEqual(
      repository.getInfo('photo.jpg')?.requests.map(request => ({
        name: request.requestedByUserName,
        withdrawn: request.withdrawnAt !== null
      })),
      [
        {name: 'anna', withdrawn: true},
        {name: 'bob', withdrawn: true}
      ]
    );
    repository.close();
  });

  it('removes an approved item from the deletion queue when its sole requester withdraws', () => {
    const repository = createRepository();
    repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}
    });
    repository.approve('photo.jpg', {id: '9', name: 'admin'}, fingerprint);

    const result = repository.withdrawOwnDeletionRequest(
      'photo.jpg', {id: '1', name: 'anna'}
    );
    assert.equal(result.status, 'withdrawn');
    assert.equal(result.item?.state, 'DECLINED');
    assert.equal(result.item?.approvedByUserName, 'admin');
    assert.equal(result.remainingRequesters, 0);
    repository.close();
  });

  it('stores independent metadata categories and exposes comments only to owners or administrators', () => {
    const repository = createRepository();
    const first = repository.requestMetadata({
      relativePath: 'photo.jpg', mediaType: 'photo',
      categories: ['faces', 'location'], actor: {id: '1', name: 'anna'},
      comment: 'Please identify the grandparents'
    });
    const duplicate = repository.requestMetadata({
      relativePath: 'photo.jpg', mediaType: 'photo',
      categories: ['faces'], actor: {id: '1', name: 'anna'}, comment: 'duplicate click'
    });
    repository.requestMetadata({
      relativePath: 'photo.jpg', mediaType: 'photo',
      categories: ['tags'], actor: {id: '2', name: 'bob'}, comment: 'missing holiday tag'
    });

    assert.deepEqual(first, {created: ['faces', 'location'], existing: []});
    assert.deepEqual(duplicate, {created: [], existing: ['faces']});
    const projection = repository.getProjection('photo.jpg');
    assert.equal(projection?.state, null);
    assert.deepEqual(projection?.metadataCategories, ['faces', 'location', 'tags']);
    assert.deepEqual(projection?.requesterNames, ['anna', 'bob']);
    assert.deepEqual(projection?.deletionRequesterNames, []);
    assert.match(projection?.itemToken || '', /^[a-f0-9]{32}$/);

    const ownerDetails = repository.getClientRequestDetails(
      projection!.itemToken!, {id: '1', name: 'anna'}, false
    );
    assert.deepEqual(ownerDetails.map(detail => detail.category), ['faces', 'location']);
    assert.ok(ownerDetails.every(detail => detail.ownRequest));
    assert.ok(ownerDetails.every(detail => detail.requestId === undefined));
    assert.equal(ownerDetails[0].comment, 'Please identify the grandparents');
    assert.deepEqual(
      repository.getClientRequestDetails(projection!.itemToken!, {id: '3', name: 'charlie'}, false),
      []
    );
    const adminDetails = repository.getClientRequestDetails(
      projection!.itemToken!, {id: '9', name: 'admin'}, true
    );
    assert.deepEqual(adminDetails.map(detail => detail.category), ['faces', 'location', 'tags']);
    assert.ok(adminDetails.every(detail => Number.isInteger(detail.requestId)));
    repository.close();
  });

  it('resolves or dismisses exactly one validated metadata request', () => {
    const repository = createRepository();
    repository.requestMetadata({
      relativePath: 'photo.jpg', mediaType: 'photo', categories: ['faces', 'location'],
      actor: {id: '1', name: 'anna'}
    });
    const projection = repository.getProjection('photo.jpg')!;
    const details = repository.getClientRequestDetails(
      projection.itemToken!, {id: '9', name: 'admin'}, true
    );
    const faces = details.find(detail => detail.category === 'faces')!;
    const location = details.find(detail => detail.category === 'location')!;

    assert.equal(
      repository.closeMetadataRequest(
        'photo.jpg', faces.requestId!, {id: '9', name: 'admin'}, 'RESOLVED'
      ).state,
      'RESOLVED'
    );
    assert.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['location']);
    assert.throws(
      () => repository.closeMetadataRequest(
        'other.jpg', location.requestId!, {id: '9', name: 'admin'}, 'DISMISSED'
      ),
      /no matching open metadata/
    );
    assert.equal(
      repository.closeMetadataRequest(
        'photo.jpg', location.requestId!, {id: '9', name: 'admin'}, 'DISMISSED'
      ).state,
      'DISMISSED'
    );
    assert.equal(repository.getProjection('photo.jpg'), null);
    repository.close();
  });

  it('blocks metadata only for the owner of an active deletion request', () => {
    const repository = createRepository();
    repository.requestDeletion({
      relativePath: 'photo.jpg', mediaType: 'photo', fingerprint,
      actor: {id: '1', name: 'anna'}
    });

    assert.throws(
      () => repository.requestMetadata({
        relativePath: 'photo.jpg', mediaType: 'photo', categories: ['faces'],
        actor: {id: '1', name: 'anna'}
      }),
      /while your deletion request is active/
    );
    assert.deepEqual(
      repository.requestMetadata({
        relativePath: 'photo.jpg', mediaType: 'photo', categories: ['tags'],
        actor: {id: '2', name: 'bob'}
      }),
      {created: ['tags'], existing: []}
    );
    assert.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['tags']);
    repository.close();
  });

  it('withdraws only the owners requests and lets administrators resolve what remains', () => {
    const repository = createRepository();
    repository.requestMetadata({
      relativePath: 'photo.jpg', mediaType: 'photo', categories: ['faces', 'other'],
      actor: {id: '1', name: 'anna'}
    });
    repository.requestMetadata({
      relativePath: 'photo.jpg', mediaType: 'photo', categories: ['tags'],
      actor: {id: '2', name: 'bob'}
    });

    const withdrawn = repository.withdrawOwnCurationRequests('photo.jpg', {id: '1', name: 'anna'});
    assert.deepEqual(withdrawn, {deletionWithdrawn: false, metadataWithdrawn: 2});
    assert.deepEqual(repository.getProjection('photo.jpg')?.metadataCategories, ['tags']);
    assert.equal(
      repository.closeMetadataRequests('photo.jpg', {id: '9', name: 'admin'}, 'RESOLVED', 'fixed XMP'),
      1
    );
    assert.equal(repository.getProjection('photo.jpg'), null);
    assert.throws(
      () => repository.closeMetadataRequests('photo.jpg', {id: '9', name: 'admin'}, 'DISMISSED'),
      /no open metadata/
    );
    repository.close();
  });

  it('validates metadata categories and comment length on the server', () => {
    const repository = createRepository();
    assert.throws(
      () => repository.requestMetadata({
        relativePath: 'photo.jpg', mediaType: 'photo', categories: [],
        actor: {id: '1', name: 'anna'}
      }),
      /valid metadata correction category/
    );
    assert.throws(
      () => repository.requestMetadata({
        relativePath: 'photo.jpg', mediaType: 'photo', categories: ['other'],
        actor: {id: '1', name: 'anna'}, comment: 'x'.repeat(101)
      }),
      /comment exceeds 100/
    );
    assert.equal(repository.getProjection('photo.jpg'), null);
    repository.close();
  });
});

describe('security and synthetic metadata', () => {
  it('rejects absolute and escaping paths', () => {
    assert.throws(() => normalizeRelativeMediaPath('../../etc/passwd'), /escapes/);
    assert.throws(() => normalizeRelativeMediaPath('/etc/passwd'), /relative/);
    assert.throws(() => normalizeRelativeMediaPath('C:\\Windows\\file.jpg'), /relative/);
    assert.equal(normalizeRelativeMediaPath('./2024\\photo.jpg'), '2024/photo.jpg');
  });

  it('replaces only internal curation tags', () => {
    assert.deepEqual(
      applyCurationState(['family', 'pg-curation:delete-pending'], 'APPROVED'),
      ['family', 'pg-curation:delete-approved', 'pg-curation:open']
    );
    assert.deepEqual(applyCurationState(['family', 'pg-curation:delete-error'], 'DECLINED'), ['family']);
  });

  it('projects deletion ownership separately from general request ownership', () => {
    assert.deepEqual(
      applyCurationProjection(['family'], {
        state: 'PENDING',
        requesterNames: ['anna', 'bob'],
        deletionRequesterNames: ['anna'],
        metadataCategories: ['faces']
      }),
      [
        'family',
        'pg-curation:delete-pending',
        'pg-curation:open',
        'pg-curation:category:faces',
        'pg-curation:requested-by:anna',
        'pg-curation:requested-by:bob',
        'pg-curation:delete-requested-by:anna'
      ]
    );
  });

  it('calculates a SHA-256 fingerprint from a stable file', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'pg2-fingerprint-test-'));
    const file = path.join(folder, 'photo.jpg');
    writeFileSync(file, 'family photo fixture');
    const result = await fingerprintFile(file);
    assert.equal(result.hashAlgorithm, 'sha256');
    assert.equal(result.fileSize, 20);
    assert.equal(result.fileHash.length, 64);
    rmSync(folder, {recursive: true, force: true});
  });
});

describe('database migrations', () => {
  it('upgrades a version-1 deletion database without losing its queue', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'pg2-curation-migration-'));
    const databasePath = path.join(folder, 'curation.sqlite');
    const legacy = new Database(databasePath);
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

    const repository = new CurationRepository(new CurationDatabase(databasePath));
    const projection = repository.getProjection('legacy.jpg');
    assert.equal(projection?.state, 'PENDING');
    assert.deepEqual(projection?.requesterNames, ['anna']);
    assert.match(projection?.itemToken || '', /^[a-f0-9]{32}$/);
    repository.close();
    rmSync(folder, {recursive: true, force: true});
  });
});
