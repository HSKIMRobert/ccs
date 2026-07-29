import * as fs from 'fs';
import { performance } from 'perf_hooks';
import * as lockfile from 'proper-lockfile';

const DEFAULT_STALE_MS = 10000;
const DEFAULT_RETRY_DELAY_MS = 200;
const DEFAULT_RETRY_TIMEOUT_MS = 10000;

interface SyncLockRetryOptions {
  description: string;
  staleMs?: number;
  retryDelayMs?: number;
  retryTimeoutMs?: number;
}

export function withSyncLockRetry<T>(
  lockTarget: string,
  callback: () => T,
  options: SyncLockRetryOptions
): T {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const retryTimeoutMs = options.retryTimeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS;
  const startedAt = performance.now();
  let release: (() => void) | undefined;
  let contendedLockPath: string | undefined;
  let lastContentionError: unknown;

  for (;;) {
    if (contendedLockPath && fs.existsSync(contendedLockPath)) {
      sleepBeforeRetry(
        startedAt,
        retryDelayMs,
        retryTimeoutMs,
        options.description,
        lastContentionError
      );
      continue;
    }

    if (contendedLockPath && performance.now() - startedAt >= retryTimeoutMs) {
      throw buildLockTimeoutError(options.description, retryTimeoutMs, lastContentionError);
    }

    try {
      release = lockfile.lockSync(lockTarget, { stale: staleMs }) as () => void;
      break;
    } catch (error) {
      if (!isLockContentionError(error)) {
        throw error;
      }
      contendedLockPath ??= `${fs.realpathSync(lockTarget)}.lock`;
      lastContentionError = error;
      sleepBeforeRetry(startedAt, retryDelayMs, retryTimeoutMs, options.description, error);
    }
  }

  try {
    return callback();
  } finally {
    try {
      release();
    } catch {
      // Best-effort release.
    }
  }
}

function isLockContentionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ELOCKED' || code === 'ENOTACQUIRED';
}

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }

  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
      // Fall back for runtimes without Atomics.wait.
    }
  }
}

function sleepBeforeRetry(
  startedAt: number,
  retryDelayMs: number,
  retryTimeoutMs: number,
  description: string,
  cause: unknown
): void {
  const elapsedMs = performance.now() - startedAt;
  if (elapsedMs >= retryTimeoutMs) {
    throw buildLockTimeoutError(description, retryTimeoutMs, cause);
  }
  sleepSync(Math.min(retryDelayMs, retryTimeoutMs - elapsedMs));
}

function buildLockTimeoutError(
  description: string,
  timeoutMs: number,
  cause: unknown
): NodeJS.ErrnoException {
  const causeCode = (cause as NodeJS.ErrnoException | undefined)?.code;
  const error = new Error(
    `Failed to acquire ${description} after ${timeoutMs}ms; another CCS process may still be updating CLIProxy state. Wait for it to finish, then retry.`
  ) as NodeJS.ErrnoException & { cause?: unknown };
  error.code = causeCode === 'ENOTACQUIRED' ? 'ENOTACQUIRED' : 'ELOCKED';
  error.cause = cause;
  return error;
}
