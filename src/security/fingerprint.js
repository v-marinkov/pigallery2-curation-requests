"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintFile = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const sha256 = async (filePath) => new Promise((resolve, reject) => {
    const hash = (0, crypto_1.createHash)('sha256');
    const stream = (0, fs_1.createReadStream)(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
});
const fingerprintFile = async (filePath) => {
    const before = await fs_1.promises.stat(filePath);
    if (!before.isFile()) {
        throw new Error('Selected media is not a regular file');
    }
    const fileHash = await sha256(filePath);
    const after = await fs_1.promises.stat(filePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error('Media changed while its fingerprint was being calculated');
    }
    return {
        fileSize: after.size,
        fileMtime: Math.trunc(after.mtimeMs),
        fileHash,
        hashAlgorithm: 'sha256'
    };
};
exports.fingerprintFile = fingerprintFile;
//# sourceMappingURL=fingerprint.js.map