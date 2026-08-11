import {createHash} from 'crypto';
import {createReadStream, promises as fs} from 'fs';
import {FileFingerprint} from '../domain';

const sha256 = async (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

export const fingerprintFile = async (filePath: string): Promise<FileFingerprint> => {
  const before = await fs.stat(filePath);
  if (!before.isFile()) {
    throw new Error('Selected media is not a regular file');
  }
  const fileHash = await sha256(filePath);
  const after = await fs.stat(filePath);
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
