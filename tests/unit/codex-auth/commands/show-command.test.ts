/**
 * Tests for codex-auth show command.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempDir: string;
let ccsHome: string;
const ORIG_CCS_HOME = process.env.CCS_HOME;
const ORIG_CCS_CODEX_PROFILE = process.env.CCS_CODEX_PROFILE;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-show-test-'));
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
});

async function makeCtx(...names: string[]) {
  const { CodexProfileRegistry } = await import(
    '../../../../src/codex-auth/codex-profile-registry'
  );
  const reg = new CodexProfileRegistry();
  for (const n of names) {
    reg.createProfile(n, { created: new Date().toISOString(), last_used: null });
  }
  return { registry: reg, version: '0.0.0-test' };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...a: unknown[]) => chunks.push(a.map(String).join(' ') + '\n');
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
    process.stdout.write = origWrite;
  }
  return chunks.join('');
}

// ── empty list ────────────────────────────────────────────────────────────────

describe('handleShowCodex — empty list', () => {
  it('shows "No Codex profiles" message when registry is empty', async () => {
    const { handleShowCodex } = await import('../../../../src/codex-auth/commands/show-command');
    const ctx = await makeCtx();
    const out = await captureStdout(() => handleShowCodex(ctx, []));
    expect(out).toContain('No Codex profiles');
    expect(out).toContain('ccsx auth create');
  });
});

// ── list with default marker ──────────────────────────────────────────────────

describe('handleShowCodex — default marker', () => {
  it('marks default profile in STATE column', async () => {
    const { handleShowCodex } = await import('../../../../src/codex-auth/commands/show-command');
    const ctx = await makeCtx('alpha', 'beta');
    ctx.registry.setDefault('alpha');

    const out = await captureStdout(() => handleShowCodex(ctx, []));
    expect(out).toContain('alpha');
    expect(out).toContain('default');
  });
});

// ── active(missing) row at top (D14) ─────────────────────────────────────────

describe('handleShowCodex — active(missing) at top', () => {
  it('shows active(missing) row at top when CCS_CODEX_PROFILE points to deleted profile', async () => {
    const { handleShowCodex } = await import('../../../../src/codex-auth/commands/show-command');
    const ctx = await makeCtx('realprofile');
    process.env.CCS_CODEX_PROFILE = 'deletedprofile'; // not in registry

    const out = await captureStdout(() => handleShowCodex(ctx, []));
    expect(out).toContain('active(missing)');
    // Table truncates long names — match on prefix
    expect(out).toContain('deletedprof');
    // active(missing) row appears before realprofile in the table
    const missingIdx = out.indexOf('deletedprof');
    const realIdx = out.indexOf('realprofile');
    expect(missingIdx).toBeLessThan(realIdx);
  });
});

// ── detail view ───────────────────────────────────────────────────────────────

describe('handleShowCodex — detail view', () => {
  it('shows detail for named profile', async () => {
    const { handleShowCodex } = await import('../../../../src/codex-auth/commands/show-command');
    const ctx = await makeCtx('myprofile');
    const out = await captureStdout(() => handleShowCodex(ctx, ['myprofile']));
    expect(out).toContain('myprofile');
    expect(out).toContain('auth.json');
    expect(out).toContain('missing'); // auth.json not present
  });

  it('detail view shows <unknown> for email when auth.json missing', async () => {
    const { handleShowCodex } = await import('../../../../src/codex-auth/commands/show-command');
    const ctx = await makeCtx('noauth');
    const out = await captureStdout(() => handleShowCodex(ctx, ['noauth']));
    expect(out).toContain('<unknown>');
  });

  it('does not crash with malformed auth.json', async () => {
    const { handleShowCodex } = await import('../../../../src/codex-auth/commands/show-command');
    const ctx = await makeCtx('malformed');

    // Write malformed auth.json
    const profileDir = path.join(ccsHome, '.ccs', 'codex-instances', 'malformed');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'auth.json'), 'NOT_JSON{{{');

    const out = await captureStdout(() => handleShowCodex(ctx, ['malformed']));
    // Should show present but not crash; email shows <invalid> or <unknown>
    expect(out).toContain('present');
    expect(out).not.toContain('Error');
  });
});
