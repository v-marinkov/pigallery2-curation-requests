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
        strict_1.default.deepEqual(repository.getProjection('2024/Christmas/IMG_1234.jpg'), {
            state: 'PENDING', requesterNames: ['anna', 'bob']
        });
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
        strict_1.default.deepEqual(repository.getProjection('photo.jpg'), {
            state: 'PENDING', requesterNames: ['bob']
        });
        const duplicate = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '1', name: 'anna' });
        strict_1.default.equal(duplicate.status, 'not_requester');
        strict_1.default.equal(duplicate.remainingRequesters, 1);
        const last = repository.withdrawOwnDeletionRequest('photo.jpg', { id: '2', name: 'bob' });
        strict_1.default.equal(last.status, 'withdrawn');
        strict_1.default.equal(last.item?.state, 'DECLINED');
        strict_1.default.equal(last.item?.declinedByUserName, 'bob');
        strict_1.default.equal(last.remainingRequesters, 0);
        strict_1.default.deepEqual(repository.getProjection('photo.jpg'), {
            state: 'DECLINED', requesterNames: []
        });
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
});
(0, node_test_1.describe)('security and synthetic metadata', () => {
    (0, node_test_1.it)('rejects absolute and escaping paths', () => {
        strict_1.default.throws(() => (0, paths_1.normalizeRelativeMediaPath)('../../etc/passwd'), /escapes/);
        strict_1.default.throws(() => (0, paths_1.normalizeRelativeMediaPath)('/etc/passwd'), /relative/);
        strict_1.default.throws(() => (0, paths_1.normalizeRelativeMediaPath)('C:\\Windows\\file.jpg'), /relative/);
        strict_1.default.equal((0, paths_1.normalizeRelativeMediaPath)('./2024\\photo.jpg'), '2024/photo.jpg');
    });
    (0, node_test_1.it)('replaces only internal curation tags', () => {
        strict_1.default.deepEqual((0, domain_1.applyCurationState)(['family', 'pg-curation:delete-pending'], 'APPROVED'), ['family', 'pg-curation:delete-approved']);
        strict_1.default.deepEqual((0, domain_1.applyCurationState)(['family', 'pg-curation:delete-error'], 'DECLINED'), ['family']);
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
//# sourceMappingURL=repository.test.js.map