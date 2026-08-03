import * as fs from 'fs';
import * as path from 'path';

import { info, warn } from '../../utils/ui';
import { getLstatSync } from './fs-helpers';

export type DivergedFileAdoption = 'not-claimed' | 'claimed';

let adoptionClaimSequence = 0;

function resolveLexicalSymlinkChain(targetPath: string): string {
  let currentPath = path.resolve(targetPath);
  const visited = new Set<string>();
  while (true) {
    if (visited.has(currentPath)) {
      throw Object.assign(new TypeError(`Symlink loop while resolving ${targetPath}`), {
        code: 'ELOOP',
      });
    }
    visited.add(currentPath);

    const stats = getLstatSync(currentPath);
    if (!stats?.isSymbolicLink()) return currentPath;
    currentPath = path.resolve(path.dirname(currentPath), fs.readlinkSync(currentPath));
  }
}

export function assertAdoptionPathAbsent(
  managedPath: string,
  adoption: DivergedFileAdoption
): void {
  if (adoption === 'claimed' && getLstatSync(managedPath)) {
    throw Object.assign(new TypeError(`Path reappeared during reconciliation: ${managedPath}`), {
      code: 'EEXIST',
    });
  }
}

export function recoverOrphanedCanonicalClaim(canonicalPath: string): boolean {
  const writePath = resolveLexicalSymlinkChain(canonicalPath);
  const directory = path.dirname(writePath);
  const prefix = `${path.basename(writePath)}.ccs-canonical-claim-`;
  let candidates: string[];
  try {
    candidates = fs
      .readdirSync(directory)
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => path.join(directory, entry))
      .filter((entryPath) => fs.lstatSync(entryPath).isFile())
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  const claimPath = candidates[0];
  if (!claimPath) return false;

  let recovered = false;
  if (!getLstatSync(writePath)) {
    fs.linkSync(claimPath, writePath);
    fs.unlinkSync(claimPath);
    candidates.shift();
    recovered = true;
    console.log(warn(`Recovered interrupted canonical adoption at ${canonicalPath}`));
  }

  for (const leftoverClaim of candidates) {
    const recoveryBase = `${writePath}.ccs-canonical-recovery`;
    let sequence = 0;
    while (true) {
      const recoveryPath = sequence === 0 ? recoveryBase : `${recoveryBase}-${sequence}`;
      try {
        fs.linkSync(leftoverClaim, recoveryPath);
        fs.unlinkSync(leftoverClaim);
        console.log(warn(`Quarantined interrupted canonical claim at ${recoveryPath}`));
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        sequence++;
      }
    }
  }
  return recovered;
}

function preserveClaim(claimPath: string, divergedPath: string, reason: string): string {
  const recoveryBase = `${divergedPath}.ccs-adopt-recovery`;
  let sequence = 0;
  while (true) {
    const recoveryPath = sequence === 0 ? recoveryBase : `${recoveryBase}-${sequence}`;
    try {
      // link() is an atomic no-replace operation, so concurrent CCS
      // processes cannot overwrite each other's recovery artifacts.
      fs.linkSync(claimPath, recoveryPath);
      try {
        fs.unlinkSync(claimPath);
      } catch {
        // Both names preserve the same bytes; leaving the claim is safe.
      }
      console.log(warn(`${reason}; preserved content at ${recoveryPath}`));
      return recoveryPath;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        sequence++;
        continue;
      }
      console.log(warn(`${reason}; content remains at ${claimPath}${code ? ` (${code})` : ''}`));
      return claimPath;
    }
  }
}

function validateManagedJson(filePath: string, content: Buffer): boolean {
  if (path.extname(filePath).toLowerCase() !== '.json') {
    return true;
  }

  try {
    const parsed = JSON.parse(content.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    if (path.basename(filePath) === 'installed_plugins.json') {
      const registry = parsed as Record<string, unknown>;
      return (
        typeof registry.plugins === 'object' &&
        registry.plugins !== null &&
        !Array.isArray(registry.plugins)
      );
    }

    return true;
  } catch {
    return false;
  }
}

function atomicWriteFile(targetPath: string, content: Buffer, mode: number): void {
  const tempPath = `${targetPath}.ccs-write-${process.pid}-${Date.now()}-${adoptionClaimSequence++}`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx', mode);
    fs.fchmodSync(descriptor, mode);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.linkSync(tempPath, targetPath);
    fs.unlinkSync(tempPath);
  } catch (err) {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // The temp file may not have been created or may already have been renamed.
    }
    throw err;
  }
}

function publishBackupNoReplace(sourcePath: string, canonicalPath: string): string {
  const basePath = `${canonicalPath}.bak-ccs-adopt`;
  const content = fs.readFileSync(sourcePath);
  const mode = fs.statSync(sourcePath).mode & 0o777;
  let sequence = 0;
  while (true) {
    const backupPath = sequence === 0 ? basePath : `${basePath}-${sequence}`;
    try {
      atomicWriteFile(backupPath, content, mode);
      return backupPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      sequence++;
    }
  }
}

function publishAdoptedRecoveryNoReplace(sourcePath: string, divergedPath: string): string {
  const basePath = `${divergedPath}.ccs-adopted-recovery`;
  const content = fs.readFileSync(sourcePath);
  const mode = fs.statSync(sourcePath).mode & 0o777;
  let sequence = 0;
  while (true) {
    const recoveryPath = sequence === 0 ? basePath : `${basePath}-${sequence}`;
    try {
      atomicWriteFile(recoveryPath, content, mode);
      return recoveryPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      sequence++;
    }
  }
}

function restoreCanonicalClaim(claimPath: string, writePath: string, canonicalPath: string): void {
  try {
    fs.linkSync(claimPath, writePath);
    fs.unlinkSync(claimPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    publishBackupNoReplace(claimPath, canonicalPath);
    fs.unlinkSync(claimPath);
  }
}

function getCanonicalFile(canonicalPath: string): {
  content: Buffer | null;
  mode: number;
  mtimeMs: number | null;
  writePath: string;
} {
  const canonicalLstat = getLstatSync(canonicalPath);
  if (!canonicalLstat) {
    return { content: null, mode: 0o600, mtimeMs: null, writePath: canonicalPath };
  }

  let writePath = canonicalPath;
  if (canonicalLstat.isSymbolicLink()) {
    writePath = fs.realpathSync.native(canonicalPath);
  }

  const canonicalStats = fs.statSync(canonicalPath);
  if (!canonicalStats.isFile()) {
    throw Object.assign(new TypeError(`Canonical path is not a regular file: ${canonicalPath}`), {
      code: 'EINVAL',
    });
  }

  return {
    content: fs.readFileSync(canonicalPath),
    mode: canonicalStats.mode & 0o777,
    mtimeMs: canonicalStats.mtimeMs,
    writePath,
  };
}

export function adoptDivergedFileContent(
  divergedPath: string,
  canonicalPath: string
): DivergedFileAdoption {
  const initialStats = getLstatSync(divergedPath);
  if (!initialStats?.isFile()) {
    return 'not-claimed';
  }

  const claimPath = `${divergedPath}.ccs-adopt-claim-${process.pid}-${Date.now()}-${adoptionClaimSequence++}`;
  try {
    fs.renameSync(divergedPath, claimPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.log(
      warn(
        `Unable to claim diverged ${divergedPath}; preserving original${code ? ` (${code})` : ''}`
      )
    );
    throw err;
  }

  let canonicalClaimPath: string | null = null;
  let canonicalWritePath: string | null = null;
  let divergencePreserved = false;
  try {
    const claimedStats = fs.lstatSync(claimPath);
    if (!claimedStats.isFile()) {
      preserveClaim(claimPath, divergedPath, `Refusing non-regular divergence at ${divergedPath}`);
      divergencePreserved = true;
      throw Object.assign(new TypeError(`Refusing non-regular divergence at ${divergedPath}`), {
        code: 'EINVAL',
      });
    }

    if (getLstatSync(divergedPath)) {
      preserveClaim(claimPath, divergedPath, `Concurrent replacement detected at ${divergedPath}`);
      divergencePreserved = true;
      throw Object.assign(new TypeError(`Concurrent replacement detected at ${divergedPath}`), {
        code: 'EEXIST',
      });
    }

    const diverged = fs.readFileSync(claimPath);
    if (!validateManagedJson(divergedPath, diverged)) {
      preserveClaim(claimPath, divergedPath, `Refusing malformed managed JSON at ${divergedPath}`);
      return 'claimed';
    }

    const canonical = getCanonicalFile(canonicalPath);
    let current = canonical.content;
    let publishMode = canonical.mode;
    if (current) {
      canonicalWritePath = canonical.writePath;
      canonicalClaimPath = `${canonical.writePath}.ccs-canonical-claim-${process.pid}-${Date.now()}-${adoptionClaimSequence++}`;
      fs.renameSync(canonical.writePath, canonicalClaimPath);
      const currentStats = fs.statSync(canonicalClaimPath);
      publishMode = currentStats.mode & 0o777;
      current = fs.readFileSync(canonicalClaimPath);
      if (diverged.equals(current)) {
        restoreCanonicalClaim(canonicalClaimPath, canonical.writePath, canonicalPath);
        canonicalClaimPath = null;
        fs.unlinkSync(claimPath);
        return 'claimed';
      }
      if (claimedStats.mtimeMs <= currentStats.mtimeMs) {
        restoreCanonicalClaim(canonicalClaimPath, canonical.writePath, canonicalPath);
        canonicalClaimPath = null;
        preserveClaim(
          claimPath,
          divergedPath,
          `Refusing stale or ambiguously-timed divergence at ${divergedPath}`
        );
        return 'claimed';
      }
    }

    if (canonicalClaimPath) {
      publishBackupNoReplace(canonicalClaimPath, canonicalPath);
    }
    publishAdoptedRecoveryNoReplace(claimPath, divergedPath);

    atomicWriteFile(canonical.writePath, diverged, publishMode);
    if (!fs.readFileSync(canonicalPath).equals(diverged)) {
      throw Object.assign(
        new TypeError(`Canonical adoption postcondition failed: ${canonicalPath}`),
        {
          code: 'EAGAIN',
        }
      );
    }
    if (canonicalClaimPath) {
      fs.unlinkSync(canonicalClaimPath);
      canonicalClaimPath = null;
    }
    if (getLstatSync(divergedPath)) {
      preserveClaim(claimPath, divergedPath, `Concurrent replacement detected at ${divergedPath}`);
      divergencePreserved = true;
      throw Object.assign(new TypeError(`Concurrent replacement detected at ${divergedPath}`), {
        code: 'EEXIST',
      });
    }
    fs.unlinkSync(claimPath);
    console.log(
      info(`Adopted diverged ${path.basename(divergedPath)} content into ${canonicalPath}`)
    );
    return 'claimed';
  } catch (err) {
    if (canonicalClaimPath && canonicalWritePath) {
      restoreCanonicalClaim(canonicalClaimPath, canonicalWritePath, canonicalPath);
      canonicalClaimPath = null;
    }
    if (divergencePreserved) {
      throw err;
    }
    if (!getLstatSync(divergedPath)) {
      try {
        fs.renameSync(claimPath, divergedPath);
      } catch {
        preserveClaim(claimPath, divergedPath, `Unable to restore diverged ${divergedPath}`);
      }
    } else {
      preserveClaim(claimPath, divergedPath, `Unable to restore diverged ${divergedPath}`);
    }
    throw err;
  }
}
