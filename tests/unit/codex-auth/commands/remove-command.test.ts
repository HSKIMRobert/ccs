/**
 * Tests for codex-auth remove command.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempDir: string;
let ccsHome: string;
const ORIG_CCS_HOME = process.env.CCS_HOME;
const ORIG_CCS_CODEX_PROFILE = process.env.CCS_CODEX_PROFILE;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-remove-test-'));
  ccsHome = path.join(tempDir, 'ccs');
  fs.mkdirSync(path.join(ccsHome, '.ccs'), { recursive: true });
  process.env.CCS_HOME = ccsHome;
  delete process.env.CCS_CODEX_PROFILE;
});

afterEach(() => {
  if (ORIG_CCS_HOME === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = ORIG_CCS_HOME;
  if (ORIG_CCS_CODEX_PROFILE === undefined) delete process.env.CCS_CODEX_PROFILE;
  else process.env.CCS_CODEX_PROFILE = ORIG_CCS_CODEX_PROFILE;
  fs.rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

async function makeCtx(...names: string[]) {
  const { CodexProfileRegistry } = await import(
    '../../../../src/codex-auth/codex-profile-registry'
  );
  const reg = new CodexProfileRegistry();
  for (const n of names) {
    reg.createProfile(n, { created: new Date().toISOString(), last_used: null });
    // Create the profile dir too
    const dir = path.join(ccsHome, '.ccs', 'codex-instances', n);
    fs.mkdirSync(dir, { recursive: true });
  }
  return { registry: reg, version: '0.0.0-test' };
}

function mockConfirmYes() {
  return import('../../../../src/utils/prompt').then((mod) => {
    spyOn(mod.InteractivePrompt, 'confirm').mockResolvedValue(true);
  });
}

function mockConfirmNo() {
  return import('../../../../src/utils/prompt').then((mod) => {
    spyOn(mod.InteractivePrompt, 'confirm').mockResolvedValue(false);
  });
}

// ── non-default removes cleanly ───────────────────────────────────────────────

describe('handleRemoveCodex — normal removal', () => {
  it('removes a non-default profile cleanly', async () => {
    await mockConfirmYes();
    const { handleRemoveCodex } = await import(
      '../../../../src/codex-auth/commands/remove-command'
    );
    const ctx = await makeCtx('alpha', 'beta');
    ctx.registry.setDefault('alpha');

    const out: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(' '));
    try {
      await handleRemoveCodex(ctx, ['beta', '--yes']);
    } finally {
      console.log = origLog;
    }

    expect(ctx.registry.hasProfile('beta')).toBe(false);
    expect(out.some((l) => l.includes('removed'))).toBe(true);
  });
});

// ── default with others → refuses without --force ────────────────────────────

describe('handleRemoveCodex — default guard', () => {
  it('refuses to remove default when others exist without --force', async () => {
    const { handleRemoveCodex } = await import(
      '../../../../src/codex-auth/commands/remove-command'
    );
    const ctx = await makeCtx('alpha', 'beta');
    ctx.registry.setDefault('alpha');

    let exitCode = -1;
    const origExit = process.exit;
    process.exit = (code?: number) => {
      exitCode = code ?? 0;
      throw new Error('exit');
    };

    const out: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(' '));
    try {
      await handleRemoveCodex(ctx, ['alpha']);
    } catch {
      /* process.exit */
    } finally {
      process.exit = origExit;
      console.log = origLog;
    }

    expect(exitCode).toBeGreaterThan(0);
    expect(ctx.registry.hasProfile('alpha')).toBe(true); // not removed
    // Hint lines still go to stdout; user-facing error now goes to stderr via exitWithError
    expect(out.some((l) => l.includes('ccsx auth switch'))).toBe(true);
  });

  it('allows removal of default with --force', async () => {
    await mockConfirmYes();
    const { handleRemoveCodex } = await import(
      '../../../../src/codex-auth/commands/remove-command'
    );
    const ctx = await makeCtx('alpha', 'beta');
    ctx.registry.setDefault('alpha');

    await handleRemoveCodex(ctx, ['alpha', '--force', '--yes']);
    expect(ctx.registry.hasProfile('alpha')).toBe(false);
  });
});

// ── only profile → allows removal ────────────────────────────────────────────

describe('handleRemoveCodex — only profile', () => {
  it('allows removal of the only profile (even if default)', async () => {
    await mockConfirmYes();
    const { handleRemoveCodex } = await import(
      '../../../../src/codex-auth/commands/remove-command'
    );
    const ctx = await makeCtx('solo');
    ctx.registry.setDefault('solo');

    await handleRemoveCodex(ctx, ['solo', '--yes']);
    expect(ctx.registry.hasProfile('solo')).toBe(false);
  });
});

// ── confirmation prompt ───────────────────────────────────────────────────────

describe('handleRemoveCodex — confirmation', () => {
  it('cancels when user declines confirmation', async () => {
    await mockConfirmNo();
    const { handleRemoveCodex } = await import(
      '../../../../src/codex-auth/commands/remove-command'
    );
    const ctx = await makeCtx('keepme');

    const out: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(' '));
    try {
      await handleRemoveCodex(ctx, ['keepme']); // no --yes
    } finally {
      console.log = origLog;
    }

    expect(ctx.registry.hasProfile('keepme')).toBe(true); // not removed
    expect(out.some((l) => l.includes('Cancelled'))).toBe(true);
  });

  it('--yes skips prompt entirely', async () => {
    // No mock — if prompt were called it would hang/throw in test
    const promptMod = await import('../../../../src/utils/prompt');
    let promptCalled = false;
    spyOn(promptMod.InteractivePrompt, 'confirm').mockImplementation(async () => {
      promptCalled = true;
      return true;
    });

    const { handleRemoveCodex } = await import(
      '../../../../src/codex-auth/commands/remove-command'
    );
    const ctx = await makeCtx('skipconfirm');

    const origLog = console.log;
    console.log = () => {};
    try {
      await handleRemoveCodex(ctx, ['skipconfirm', '--yes']);
    } finally {
      console.log = origLog;
    }

    expect(promptCalled).toBe(false);
    expect(ctx.registry.hasProfile('skipconfirm')).toBe(false);
  });
});
