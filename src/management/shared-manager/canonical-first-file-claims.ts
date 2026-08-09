import * as fs from 'fs';
import * as path from 'path';

import { warn } from '../../utils/ui';
import { getLstatSync } from './fs-helpers';

let claimSequence = 0;

export function readRegularFileContent(filePath: string): Buffer | null {
  const stats = getLstatSync(filePath);
  return stats?.isFile() ? fs.readFileSync(filePath) : null;
}

function preserveClaim(filePath: string, claimPath: string, reason: string): string {
  const basePath = `${filePath}.ccs-shared-conflict`;
  let sequence = 0;
  while (true) {
    const recoveryPath = sequence === 0 ? basePath : `${basePath}-${sequence}`;
    try {
      fs.linkSync(claimPath, recoveryPath);
      try {
        fs.unlinkSync(claimPath);
      } catch {
        // Both names preserve the same inode, so leaving the claim is safe.
      }
      console.log(warn(`${reason}; preserved content at ${recoveryPath}`));
      return recoveryPath;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        sequence++;
        continue;
      }

      try {
        fs.copyFileSync(claimPath, recoveryPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(recoveryPath, fs.statSync(claimPath).mode & 0o777);
        fs.unlinkSync(claimPath);
        console.log(
          warn(`${reason}; copied content to ${recoveryPath} (${code ?? 'link failed'})`)
        );
        return recoveryPath;
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') {
          sequence++;
          continue;
        }

        if (!getLstatSync(filePath)) {
          try {
            fs.renameSync(claimPath, filePath);
          } catch {
            // The claim remains the only recoverable copy if restoration loses a race.
          }
        }
        console.log(warn(`${reason}; unable to publish recovery, restored original when possible`));
        throw err;
      }
    }
  }
}

function interruptedClaimPaths(filePath: string): string[] {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.ccs-shared-claim-`;
  try {
    return fs
      .readdirSync(directory)
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => path.join(directory, entry))
      .filter((entryPath) => fs.lstatSync(entryPath).isFile())
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export function recoverInterruptedClaims(filePath: string): void {
  const claims = interruptedClaimPaths(filePath);
  if (claims.length === 0) return;

  if (claims.length === 1 && !getLstatSync(filePath)) {
    fs.renameSync(claims[0], filePath);
    console.log(warn(`Recovered interrupted shared-file claim at ${filePath}`));
    return;
  }

  for (const claimPath of claims) {
    preserveClaim(filePath, claimPath, `Quarantined interrupted shared-file claim for ${filePath}`);
  }
}

export function claimCanonicalFirstCopy(
  filePath: string,
  canonicalContent: Buffer | null,
  reason: string
): boolean {
  const initialStats = getLstatSync(filePath);
  if (!initialStats?.isFile()) return false;

  const claimPath = `${filePath}.ccs-shared-claim-${process.pid}-${Date.now()}-${claimSequence++}`;
  fs.renameSync(filePath, claimPath);
  if (getLstatSync(filePath)) {
    preserveClaim(filePath, claimPath, `Concurrent replacement detected at ${filePath}`);
    throw Object.assign(new TypeError(`Concurrent replacement detected at ${filePath}`), {
      code: 'EEXIST',
    });
  }

  const claimedContent = fs.readFileSync(claimPath);
  if (canonicalContent?.equals(claimedContent)) {
    fs.unlinkSync(claimPath);
  } else {
    preserveClaim(filePath, claimPath, reason);
  }
  if (getLstatSync(filePath)) {
    throw Object.assign(new TypeError(`Path reappeared during reconciliation: ${filePath}`), {
      code: 'EEXIST',
    });
  }
  return true;
}
