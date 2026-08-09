import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { loadAccountsRegistry } from '../../../src/cliproxy/accounts/registry';
import { registerSession } from '../../../src/cliproxy/session-tracker';
import { withSyncLockRetry } from '../../../src/utils/sync-lock-retry';

const ORIGINAL_CCS_HOME = process.env.CCS_HOME;
const LOCK_HOLD_MS = 400;

let tempDir: string;
let cliproxyDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-concurrent-state-locks-'));
  process.env.CCS_HOME = tempDir;
  cliproxyDir = path.join(tempDir, '.ccs', 'cliproxy');
  fs.mkdirSync(cliproxyDir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  if (ORIGINAL_CCS_HOME === undefined) {
    delete process.env.CCS_HOME;
  } else {
    process.env.CCS_HOME = ORIGINAL_CCS_HOME;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('CLIProxy state locks', () => {
  it('waits for a contended account registry lock before loading', async () => {
    const holder = await holdLock(cliproxyDir);

    try {
      expect(loadAccountsRegistry()).toEqual({ version: 1, providers: {} });
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('waits for a contended session tracker lock before registering', async () => {
    const holder = await holdLock(cliproxyDir);

    try {
      const sessionId = registerSession(8317, process.pid);
      const sessionState = JSON.parse(
        fs.readFileSync(path.join(cliproxyDir, 'sessions.json'), 'utf8')
      ) as { sessions: string[] };

      expect(sessionState.sessions).toContain(sessionId);
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('preserves stale lock recovery for account registry access', () => {
    const staleLockPath = `${cliproxyDir}.lock`;
    fs.mkdirSync(staleLockPath);
    const staleTime = new Date(Date.now() - 15000);
    fs.utimesSync(staleLockPath, staleTime, staleTime);

    expect(loadAccountsRegistry()).toEqual({ version: 1, providers: {} });
    expect(fs.existsSync(staleLockPath)).toBe(false);
  });

  it('gives actionable guidance when contention outlasts the bound', async () => {
    const holder = await holdLock(cliproxyDir);

    try {
      expect(() =>
        withSyncLockRetry(cliproxyDir, () => undefined, {
          description: 'test CLIProxy state lock',
          retryTimeoutMs: 0,
        })
      ).toThrow(
        'Failed to acquire test CLIProxy state lock after 0ms; another CCS process may still be updating CLIProxy state. Wait for it to finish, then retry.'
      );
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('does not steal a fresh lock that ages past stale while its holder remains active', async () => {
    const holder = await holdRawLock(cliproxyDir, 2800);
    let callbackRan = false;

    try {
      expect(() =>
        withSyncLockRetry(
          cliproxyDir,
          () => {
            callbackRan = true;
          },
          {
            description: 'test active CLIProxy state lock',
            staleMs: 2000,
            retryDelayMs: 50,
            retryTimeoutMs: 2300,
          }
        )
      ).toThrow('Failed to acquire test active CLIProxy state lock after 2300ms');
      expect(callbackRan).toBe(false);
      expect(holder.exitCode).toBeNull();
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('preserves all concurrent session registrations', async () => {
    const workerCount = 6;
    const gatePath = path.join(tempDir, 'session-writer-gate');
    const workerScript = path.join(tempDir, 'session-writer.ts');
    const sessionTrackerUrl = pathToFileURL(
      path.join(process.cwd(), 'src/cliproxy/session-tracker.ts')
    ).href;
    fs.writeFileSync(
      workerScript,
      `
import * as fs from 'fs';
import { registerSession } from ${JSON.stringify(sessionTrackerUrl)};

const gatePath = process.argv[2];
const readyPath = process.argv[3];
const proxyPid = Number(process.argv[4]);
fs.writeFileSync(readyPath, String(process.pid));
while (!fs.existsSync(gatePath)) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
registerSession(8317, proxyPid);
`,
      'utf8'
    );

    const workers = Array.from({ length: workerCount }, (_, index) => {
      const readyPath = path.join(tempDir, `session-writer-ready-${index}`);
      return {
        readyPath,
        child: spawn(process.execPath, [workerScript, gatePath, readyPath, String(process.pid)], {
          cwd: process.cwd(),
          env: { ...process.env, CCS_HOME: tempDir },
          stdio: ['ignore', 'ignore', 'pipe'],
        }),
      };
    });

    try {
      await Promise.all(workers.map(({ readyPath, child }) => waitForFile(readyPath, child)));
      fs.writeFileSync(gatePath, 'go');
      await Promise.all(workers.map(({ child }) => waitForSuccessfulExit(child)));

      const sessionState = JSON.parse(
        fs.readFileSync(path.join(cliproxyDir, 'sessions.json'), 'utf8')
      ) as { sessions: string[] };
      expect(sessionState.sessions).toHaveLength(workerCount);
      expect(new Set(sessionState.sessions).size).toBe(workerCount);
    } finally {
      await Promise.all(workers.map(({ child }) => stopLockHolder(child)));
    }
  });
});

async function holdLock(lockTarget: string): Promise<ChildProcess> {
  const readyPath = path.join(tempDir, `holder-ready-${Date.now()}-${Math.random()}`);
  const holderScript = path.join(tempDir, `hold-lock-${Date.now()}-${Math.random()}.cjs`);
  fs.writeFileSync(
    holderScript,
    `
const fs = require('fs');
const lockfile = require(process.argv[5]);
const release = lockfile.lockSync(process.argv[2], { stale: 10000 });
fs.writeFileSync(process.argv[3], String(process.pid));
setTimeout(() => {
  release();
  process.exit(0);
}, Number(process.argv[4]));
setTimeout(() => process.exit(2), 5000);
process.on('SIGTERM', () => {
  try { release(); } finally { process.exit(0); }
});
`,
    'utf8'
  );

  const child = spawn(
    process.execPath,
    [holderScript, lockTarget, readyPath, String(LOCK_HOLD_MS), require.resolve('proper-lockfile')],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  await waitForFile(readyPath, child);
  return child;
}

async function holdRawLock(lockTarget: string, holdMs: number): Promise<ChildProcess> {
  const readyPath = path.join(tempDir, `raw-holder-ready-${Date.now()}-${Math.random()}`);
  const holderScript = path.join(tempDir, `hold-raw-lock-${Date.now()}-${Math.random()}.cjs`);
  fs.writeFileSync(
    holderScript,
    `
const fs = require('fs');
const lockPath = process.argv[2] + '.lock';
fs.mkdirSync(lockPath);
fs.writeFileSync(process.argv[3], String(process.pid));
setTimeout(() => {
  try { fs.rmdirSync(lockPath); } catch {}
  process.exit(0);
}, Number(process.argv[4]));
setTimeout(() => process.exit(2), 5000);
process.on('SIGTERM', () => {
  try { fs.rmdirSync(lockPath); } catch {}
  process.exit(0);
});
`,
    'utf8'
  );

  const child = spawn(process.execPath, [holderScript, lockTarget, readyPath, String(holdMs)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForFile(readyPath, child);
  return child;
}

async function waitForFile(filePath: string, child: ChildProcess, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Lock holder exited before acquiring lock (code ${child.exitCode})`);
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for lock holder at ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function stopLockHolder(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }
}

async function waitForSuccessfulExit(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }
  if (child.exitCode !== 0) {
    throw new Error(`Concurrent session writer exited with code ${child.exitCode}`);
  }
}
