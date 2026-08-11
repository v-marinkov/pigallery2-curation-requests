import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import * as path from 'path';
import {CurationDatabase} from '../src/db/database';
import {CurationRepository} from '../src/db/repository';
import {FileFingerprint, applyCurationState} from '../src/domain';
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
    assert.deepEqual(repository.getProjection('2024/Christmas/IMG_1234.jpg'), {
      state: 'PENDING', requesterNames: ['anna', 'bob']
    });
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
    assert.deepEqual(repository.getProjection('photo.jpg'), {
      state: 'PENDING', requesterNames: ['bob']
    });

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
    assert.deepEqual(repository.getProjection('photo.jpg'), {
      state: 'DECLINED', requesterNames: []
    });
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
      ['family', 'pg-curation:delete-approved']
    );
    assert.deepEqual(applyCurationState(['family', 'pg-curation:delete-error'], 'DECLINED'), ['family']);
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
