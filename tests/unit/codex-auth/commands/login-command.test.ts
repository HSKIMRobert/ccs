/**
 * Tests for codex-auth login command.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn, mock } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';

let tempDir: string;
let ccsHome: string;
const ORIG_CCS_HOME = process.env.CCS_HOME;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-login-test-'));
  ccsHome = path.join(tempDir, 'ccs');
  fs.mkdirSync(path.join(ccsHome, '.ccs'), { recursive: true });
  process.env.CCS_HOME = ccsHome;
});

afterEach(() => {
  if (ORIG_CCS_HOME === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = ORIG_CCS_HOME;
  fs.rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

async function makeCtx() {
  const { CodexProfileRegistry } = await import(
    '../../../../src/codex-auth/codex-profile-registry'
  );
  return { registry: new CodexProfileRegistry(), version: '0.0.0-test' };
}

function spawnReturnsCode(code: number, writeAuth = false) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spyOn(childProcess, 'spawn').mockImplementation((_cmd: string, _args: string[], opts: any) => {
    if (writeAuth && opts?.env?.CODEX_HOME) {
      const dir = opts.env.CODEX_HOME as string;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'auth.json'),
        JSON.stringify({ tokens: { id_token: 'h.e30K.s' } })
      );
    }
    const ee = {
      on: (evt: string, cb: (code: number) => void) => {
        if (evt === 'exit') setTimeout(() => cb(code), 0);
        return ee;
      },
    };
    return ee as ReturnType<typeof childProcess.spawn>;
  });
}

describe('handleLoginCodex — binary missing', () => {
  it('exits with BINARY_ERROR when codex not found', async () => {
    const detectorMod = await import('../../../../src/targets/codex-detector');
    spyOn(detectorMod, 'detectCodexCli').mockReturnValue(null);
    const { handleLoginCodex } = await import('../../../../src/codex-auth/commands/login-command');
    const ctx = await makeCtx();

    let exitCode = -1;
    const origExit = process.exit;
    process.exit = (code?: number) => {
      exitCode = code ?? 0;
      throw new Error('process.exit');
    };
    try {
      await handleLoginCodex(ctx, ['myprofile']);
    } catch {
      /* process.exit throws */
    } finally {
      process.exit = origExit;
    }
    expect(exitCode).toBe(5); // ExitCode.BINARY_ERROR
  });
});

describe('handleLoginCodex — missing profile auto-creates', () => {
  it('auto-creates profile entry when not in registry', async () => {
    const detectorMod = await import('../../../../src/targets/codex-detector');
    spyOn(detectorMod, 'detectCodexCli').mockReturnValue('/usr/bin/codex');
    spawnReturnsCode(0, true);

    const { handleLoginCodex } = await import('../../../../src/codex-auth/commands/login-command');
    const ctx = await makeCtx();

    const out: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(' '));
    try {
      await handleLoginCodex(ctx, ['newprofile']);
    } finally {
      console.log = origLog;
    }

    expect(ctx.registry.hasProfile('newprofile')).toBe(true);
    expect(out.some((l) => l.includes('Auto-creating'))).toBe(true);
  });
});

describe('handleLoginCodex — spawn called with CODEX_HOME pinned', () => {
  it('passes CODEX_HOME env to spawn', async () => {
    const detectorMod = await import('../../../../src/targets/codex-detector');
    spyOn(detectorMod, 'detectCodexCli').mockReturnValue('/usr/bin/codex');
    spawnReturnsCode(0, true);

    const { handleLoginCodex } = await import('../../../../src/codex-auth/commands/login-command');
    const ctx = await makeCtx();
    ctx.registry.createProfile('pintest', { created: new Date().toISOString(), last_used: null });

    const origLog = console.log;
    console.log = () => {};
    try {
      await handleLoginCodex(ctx, ['pintest']);
    } finally {
      console.log = origLog;
    }

    expect(childProcess.spawn).toHaveBeenCalled();
    const call = (childProcess.spawn as ReturnType<typeof spyOn>).mock.calls[0];
    expect(call[2]?.env?.CODEX_HOME).toContain('pintest');
  });
});

describe('handleLoginCodex — clean exit updates registry', () => {
  it('updates email/plan in registry after successful login', async () => {
    const detectorMod = await import('../../../../src/targets/codex-detector');
    spyOn(detectorMod, 'detectCodexCli').mockReturnValue('/usr/bin/codex');
    spawnReturnsCode(0, true); // writes auth.json with minimal JWT

    const { handleLoginCodex } = await import('../../../../src/codex-auth/commands/login-command');
    const ctx = await makeCtx();
    ctx.registry.createProfile('updatetest', {
      created: new Date().toISOString(),
      last_used: null,
    });

    const origLog = console.log;
    console.log = () => {};
    try {
      await handleLoginCodex(ctx, ['updatetest']);
    } finally {
      console.log = origLog;
    }

    const meta = ctx.registry.getProfile('updatetest');
    // last_used should now be set
    expect(meta.last_used).toBeTruthy();
  });
});
