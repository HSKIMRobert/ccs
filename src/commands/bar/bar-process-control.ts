import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { ConfigError } from '../../errors/error-types';
import { getServerPidPath } from './bar-paths';

export interface BarServerProcessRecord {
  pid: number;
  birthIdentity: string;
}

export type BarServerStopResult =
  | 'stopped'
  | 'stale'
  | 'legacy-record'
  | 'invalid-record'
  | 'identity-mismatch'
  | 'permission-denied'
  | 'signal-failed'
  | 'timeout';

export interface BarServerStopDeps {
  getProcessBirthIdentity: (pid: number) => string | null;
  killProcess: (pid: number, signal: 'SIGTERM') => void;
  waitForProcessExit: (
    pid: number,
    birthIdentity: string,
    timeoutMs: number
  ) => Promise<'exited' | 'identity-mismatch' | 'timeout'>;
}

export function parseBarServerProcessRecord(raw: string): BarServerProcessRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<BarServerProcessRecord>;
    const pid = parsed.pid;
    if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) return null;
    if (typeof parsed.birthIdentity !== 'string' || parsed.birthIdentity.trim() === '') return null;
    return { pid: pid as number, birthIdentity: parsed.birthIdentity };
  } catch {
    return null;
  }
}

export function parseLegacyServerPid(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) ? pid : null;
}

export function serializeBarServerProcessRecord(record: BarServerProcessRecord): string {
  return JSON.stringify(record, null, 2);
}

/**
 * Return the OS process birth marker for PID reuse protection. CCS Bar is a
 * macOS app, where `ps lstart` is stable for a process lifetime. Linux uses the
 * same portable ps surface in development and CI.
 */
export function getProcessBirthIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export async function waitForProcessExit(
  pid: number,
  birthIdentity: string,
  timeoutMs: number
): Promise<'exited' | 'identity-mismatch' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentIdentity = getProcessBirthIdentity(pid);
    if (currentIdentity === null) return 'exited';
    if (currentIdentity !== birthIdentity) return 'identity-mismatch';
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return 'timeout';
}

export async function stopRecordedBarServer(
  rawRecord: string,
  deps: Partial<BarServerStopDeps> = {}
): Promise<{ result: BarServerStopResult; record: BarServerProcessRecord | null; error?: Error }> {
  const record = parseBarServerProcessRecord(rawRecord);
  if (record === null) {
    return {
      result: parseLegacyServerPid(rawRecord) === null ? 'invalid-record' : 'legacy-record',
      record: null,
    };
  }

  const getIdentity = deps.getProcessBirthIdentity ?? getProcessBirthIdentity;
  const killProcess = deps.killProcess ?? ((pid, signal) => process.kill(pid, signal));
  const waitForExit = deps.waitForProcessExit ?? waitForProcessExit;

  // Revalidate immediately before SIGTERM. A PID alone is unsafe because the OS
  // can reuse it after the recorded CCS Bar process exits.
  const currentIdentity = getIdentity(record.pid);
  if (currentIdentity === null) return { result: 'stale', record };
  if (currentIdentity !== record.birthIdentity) return { result: 'identity-mismatch', record };

  try {
    killProcess(record.pid, 'SIGTERM');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { result: 'stale', record };
    if (code === 'EPERM') return { result: 'permission-denied', record, error };
    return { result: 'signal-failed', record, error };
  }

  const waitResult = await waitForExit(record.pid, record.birthIdentity, 3_000);
  if (waitResult === 'exited') return { result: 'stopped', record };
  if (waitResult === 'identity-mismatch') return { result: 'identity-mismatch', record };
  return { result: 'timeout', record };
}

export interface ClaimedBarServerStopOutcome {
  result: BarServerStopResult | 'no-record';
  record: BarServerProcessRecord | null;
  legacyPid?: number;
  error?: Error;
  recoveryPath?: string;
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException).code === code;
}

function unlinkIfPresent(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (!isErrno(err, 'ENOENT')) throw err;
  }
}

function restoreClaimWithoutOverwrite(
  claimPath: string,
  canonicalPath: string
): string | undefined {
  try {
    fs.linkSync(claimPath, canonicalPath);
    unlinkIfPresent(claimPath);
    return undefined;
  } catch (err) {
    if (isErrno(err, 'EEXIST')) return claimPath;
    throw err;
  }
}

/**
 * Atomically claim server.pid before signaling. The serve process therefore
 * sees ENOENT during its signal handler and cannot unlink a new owner's record.
 */
export async function stopBarServerProcessFile(
  pidPath: string,
  deps: Partial<BarServerStopDeps> = {}
): Promise<ClaimedBarServerStopOutcome> {
  const claimPath = `${pidPath}.claim-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.renameSync(pidPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return { result: 'no-record', record: null };
    throw err;
  }

  let rawRecord: string;
  try {
    rawRecord = fs.readFileSync(claimPath, 'utf8').trim();
  } catch (err) {
    const recoveryPath = restoreClaimWithoutOverwrite(claimPath, pidPath);
    return {
      result: 'invalid-record',
      record: null,
      error: err instanceof Error ? err : new Error(String(err)),
      recoveryPath,
    };
  }

  const outcome = await stopRecordedBarServer(rawRecord, deps);
  if (outcome.result === 'stopped' || outcome.result === 'stale') {
    unlinkIfPresent(claimPath);
    return outcome;
  }

  const recoveryPath = restoreClaimWithoutOverwrite(claimPath, pidPath);
  return {
    ...outcome,
    legacyPid:
      outcome.result === 'legacy-record'
        ? (parseLegacyServerPid(rawRecord) ?? undefined)
        : undefined,
    recoveryPath,
  };
}

/** Remove server.pid only when it still belongs to this exact serve process. */
export function removeBarServerProcessRecordIfOwned(
  pidPath: string,
  expectedRecord: BarServerProcessRecord
): void {
  const claimPath = `${pidPath}.cleanup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.renameSync(pidPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return;
    throw err;
  }

  let claimedRecord: BarServerProcessRecord | null = null;
  try {
    claimedRecord = parseBarServerProcessRecord(fs.readFileSync(claimPath, 'utf8'));
  } catch {
    // Preserve unreadable state below.
  }

  if (
    claimedRecord?.pid === expectedRecord.pid &&
    claimedRecord.birthIdentity === expectedRecord.birthIdentity
  ) {
    unlinkIfPresent(claimPath);
    return;
  }
  restoreClaimWithoutOverwrite(claimPath, pidPath);
}

/** Claim stale discovery state so a replacement write can never be unlinked. */
export function removeBarDiscoveryIfNoProcess(barJsonPath: string, pidPath: string): boolean {
  const claimPath = `${barJsonPath}.cleanup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.renameSync(barJsonPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return true;
    throw err;
  }
  if (fs.existsSync(pidPath)) {
    restoreClaimWithoutOverwrite(claimPath, barJsonPath);
    return false;
  }
  unlinkIfPresent(claimPath);
  return true;
}

export async function stopDetachedBarServer(ccsDir: string): Promise<void> {
  const pidPath = getServerPidPath(ccsDir);
  try {
    const outcome = await stopBarServerProcessFile(pidPath);
    if (outcome.result !== 'stopped' && outcome.result !== 'stale') {
      throw new ConfigError(
        `Safe CCS Bar stop aborted (${outcome.result}); recovery state was preserved`,
        outcome.recoveryPath ?? pidPath
      );
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      `Cannot safely stop CCS Bar process: ${err instanceof Error ? err.message : String(err)}`,
      pidPath
    );
  }
}
