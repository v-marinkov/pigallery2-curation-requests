import * as path from 'path';

export const normalizeRelativeMediaPath = (input: string): string => {
  if (!input || input.includes('\0')) {
    throw new Error('Media path is empty or invalid');
  }
  const portable = input.replace(/\\/g, '/');
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new Error('Media path must be relative');
  }
  const normalized = path.posix.normalize(portable).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Media path escapes the photo root');
  }
  return normalized;
};

export const resolveDatabasePath = (configuredPath: string, databaseFolder: string): string => {
  if (!configuredPath.trim()) {
    throw new Error('Curation database path is empty');
  }
  return path.isAbsolute(configuredPath) ? path.normalize(configuredPath) : path.resolve(databaseFolder, configuredPath);
};
