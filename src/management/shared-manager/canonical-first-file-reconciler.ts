import * as fs from 'fs';
import * as path from 'path';

import { info, warn } from '../../utils/ui';
import ProfileRegistry from '../../auth/profile-registry';
import { isProfileLocalSharedResourceMode } from '../../auth/shared-resource-policy';
import {
  isSafeAccountInstancePath,
  listAccountInstancePaths,
  normalizeAccountInstanceName,
} from '../instance-directory';
import { adoptDivergedFileContent } from './diverged-file-adopter';
import { getLstatSync } from './fs-helpers';
import {
  claimCanonicalFirstCopy,
  readRegularFileContent,
  recoverInterruptedClaims,
} from './canonical-first-file-claims';

interface CanonicalFirstRoots {
  claudeDir: string;
  sharedDir: string;
  instancesDir: string;
}

function candidatePaths(roots: CanonicalFirstRoots, fileName: string): string[] {
  const profiles = new ProfileRegistry().getAllProfilesMerged();
  const profilesByInstanceName = new Map<string, Array<(typeof profiles)[string]>>();
  for (const [profileName, profile] of Object.entries(profiles)) {
    const instanceName = normalizeAccountInstanceName(profileName);
    const matches = profilesByInstanceName.get(instanceName) ?? [];
    matches.push(profile);
    profilesByInstanceName.set(instanceName, matches);
  }

  return [
    path.join(roots.sharedDir, fileName),
    ...listAccountInstancePaths(roots.instancesDir)
      .filter((instancePath) => {
        const instanceName = normalizeAccountInstanceName(path.basename(instancePath));
        const matches = profilesByInstanceName.get(instanceName) ?? [];
        if (matches.length > 1) return false;
        return matches.length === 0 || !isProfileLocalSharedResourceMode(matches[0]);
      })
      .map((instancePath) => path.join(instancePath, fileName)),
  ];
}

function reconcileCandidatesAgainstCanonical(
  canonicalPath: string,
  candidates: readonly string[]
): void {
  let canonicalContent: Buffer | null = null;
  try {
    canonicalContent = fs.readFileSync(canonicalPath);
  } catch {
    // A present but unreadable or dangling canonical path still owns precedence.
  }

  for (const candidatePath of candidates) {
    claimCanonicalFirstCopy(
      candidatePath,
      canonicalContent,
      `Canonical ${path.basename(canonicalPath)} wins over divergent copy at ${candidatePath}`
    );
  }
}

/**
 * Reconcile a canonical-first shared file before any seed or symlink mutation.
 * Existing canonical content always wins. With no canonical, one unique byte
 * variant is adopted; conflicting variants are all quarantined for recovery.
 */
export function reconcileCanonicalFirstFile(roots: CanonicalFirstRoots, fileName: string): void {
  const canonicalPath = path.join(roots.claudeDir, fileName);
  const candidates = candidatePaths(roots, fileName);
  for (const candidatePath of candidates) {
    if (candidatePath !== path.join(roots.sharedDir, fileName)) {
      const instancePath = path.dirname(candidatePath);
      if (!isSafeAccountInstancePath(roots.instancesDir, instancePath)) continue;
    }
    recoverInterruptedClaims(candidatePath);
  }

  if (getLstatSync(canonicalPath)) {
    reconcileCandidatesAgainstCanonical(canonicalPath, candidates);
    return;
  }

  const variants: Array<{ path: string; content: Buffer }> = [];
  for (const candidatePath of candidates) {
    const content = readRegularFileContent(candidatePath);
    if (content) variants.push({ path: candidatePath, content });
  }
  if (variants.length === 0) return;

  const uniqueContents: Buffer[] = [];
  for (const variant of variants) {
    if (!uniqueContents.some((content) => content.equals(variant.content))) {
      uniqueContents.push(variant.content);
    }
  }

  if (uniqueContents.length === 1) {
    adoptDivergedFileContent(variants[0].path, canonicalPath);
    reconcileCandidatesAgainstCanonical(canonicalPath, candidates);
    console.log(info(`Adopted the only existing ${fileName} variant as canonical content`));
    return;
  }

  for (const variant of variants) {
    claimCanonicalFirstCopy(
      variant.path,
      null,
      `Conflicting ${fileName} variants found while no canonical file exists`
    );
  }
  console.log(
    warn(
      `No ${fileName} variant was selected; recover one of the .ccs-shared-conflict files explicitly`
    )
  );
}

/** Preserve a later divergent copy without allowing it to replace canonical content. */
export function preserveCanonicalFirstDivergence(
  divergedPath: string,
  canonicalPath: string
): boolean {
  let canonicalContent: Buffer | null = null;
  try {
    canonicalContent = fs.readFileSync(canonicalPath);
  } catch {
    // Preserve the divergence when canonical cannot be compared safely.
  }

  return claimCanonicalFirstCopy(
    divergedPath,
    canonicalContent,
    `Canonical ${path.basename(canonicalPath)} wins over divergent copy at ${divergedPath}`
  );
}
