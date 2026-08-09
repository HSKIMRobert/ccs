import * as fs from 'fs';
import * as path from 'path';

export function isAccountInstanceName(name: string): boolean {
  return !name.startsWith('.');
}

export function normalizeAccountInstanceName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function unsafeInstancePath(targetPath: string): never {
  throw Object.assign(new TypeError(`Unsafe account instance path: ${targetPath}`), {
    code: 'EINVAL',
  });
}

export interface DirectoryIdentity {
  device: number;
  inode: number;
  realPath: string;
}

function readDirectoryIdentity(directoryPath: string): DirectoryIdentity {
  const stats = fs.lstatSync(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) unsafeInstancePath(directoryPath);
  return {
    device: stats.dev,
    inode: stats.ino,
    realPath: fs.realpathSync.native(directoryPath),
  };
}

function identitiesMatch(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return (
    left.device === right.device && left.inode === right.inode && left.realPath === right.realPath
  );
}

function createDirectoryUnderStableParent(directoryPath: string): void {
  const parentPath = path.dirname(directoryPath);
  const parentBefore = readDirectoryIdentity(parentPath);

  try {
    fs.mkdirSync(directoryPath, { mode: 0o700 });
    readDirectoryIdentity(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  let parentAfter: DirectoryIdentity;
  try {
    parentAfter = readDirectoryIdentity(parentPath);
  } catch {
    unsafeInstancePath(parentPath);
  }

  if (!identitiesMatch(parentBefore, parentAfter)) {
    unsafeInstancePath(parentPath);
  }

  readDirectoryIdentity(directoryPath);
}

function isPathWithinDirectory(candidatePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, candidatePath);
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Reject symlink roots/entries and require the real instance path to stay under the real root. */
export function isSafeAccountInstancePath(instancesDir: string, instancePath: string): boolean {
  try {
    const rootStats = fs.lstatSync(instancesDir);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return false;

    const instanceStats = fs.lstatSync(instancePath);
    if (instanceStats.isSymbolicLink() || !instanceStats.isDirectory()) return false;

    const realRoot = fs.realpathSync.native(instancesDir);
    const realInstance = fs.realpathSync.native(instancePath);
    return isPathWithinDirectory(realInstance, realRoot);
  } catch {
    return false;
  }
}

/** Create a missing managed instances root without traversing symlink parents. */
export function ensureSafeAccountInstancesDirectory(instancesDir: string): void {
  const missingPaths: string[] = [];
  let currentPath = instancesDir;

  while (true) {
    try {
      const stats = fs.lstatSync(currentPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) unsafeInstancePath(currentPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missingPaths.push(currentPath);
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) unsafeInstancePath(instancesDir);
      currentPath = parentPath;
    }
  }

  for (const directoryPath of missingPaths.reverse()) {
    createDirectoryUnderStableParent(directoryPath);
  }

  const rootStats = fs.lstatSync(instancesDir);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) unsafeInstancePath(instancesDir);
}

export function assertSafeAccountInstancePath(instancesDir: string, instancePath: string): void {
  if (!isSafeAccountInstancePath(instancesDir, instancePath)) unsafeInstancePath(instancePath);
}

/**
 * Capture the validated directory identity used by later mutation guards.
 * This is defense-in-depth for static and ordinary concurrent replacement,
 * not a hostile same-UID race boundary; that would require dirfd/openat-style APIs.
 */
export function captureSafeAccountInstanceIdentity(
  instancesDir: string,
  instancePath: string
): DirectoryIdentity {
  assertSafeAccountInstancePath(instancesDir, instancePath);
  const identity = readDirectoryIdentity(instancePath);
  assertAccountInstanceIdentity(instancesDir, instancePath, identity);
  return identity;
}

/** Require the lexical instance path to still name the validated directory. */
export function assertAccountInstanceIdentity(
  instancesDir: string,
  instancePath: string,
  expectedIdentity: DirectoryIdentity
): void {
  if (!isSafeAccountInstancePath(instancesDir, instancePath)) unsafeInstancePath(instancePath);

  let currentIdentity: DirectoryIdentity;
  try {
    currentIdentity = readDirectoryIdentity(instancePath);
  } catch {
    unsafeInstancePath(instancePath);
  }

  if (!identitiesMatch(expectedIdentity, currentIdentity)) unsafeInstancePath(instancePath);
}

export function listAccountInstanceNames(instancesDir: string): string[] {
  if (!fs.existsSync(instancesDir)) {
    return [];
  }

  return fs.readdirSync(instancesDir).filter((name) => {
    if (!isAccountInstanceName(name)) {
      return false;
    }

    return isSafeAccountInstancePath(instancesDir, path.join(instancesDir, name));
  });
}

export function listAccountInstancePaths(instancesDir: string): string[] {
  return listAccountInstanceNames(instancesDir).map((name) => path.join(instancesDir, name));
}
