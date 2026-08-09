import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findResumeSessionLanes,
  parseResumeFlagIntent,
  resolveConfiguredPlainCcsResumeLane,
} from '../../../src/auth/resume-lane-diagnostics';

describe('resume lane diagnostics', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;
  let originalUnified: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-resume-lane-'));
    originalCcsHome = process.env.CCS_HOME;
    originalUnified = process.env.CCS_UNIFIED_CONFIG;
    process.env.CCS_HOME = tempHome;
    process.env.CCS_UNIFIED_CONFIG = '1';
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;

    if (originalUnified !== undefined) process.env.CCS_UNIFIED_CONFIG = originalUnified;
    else delete process.env.CCS_UNIFIED_CONFIG;

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  function writeConfig(lines: string[]): void {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(path.join(ccsDir, 'config.yaml'), `${lines.join('\n')}\n`, 'utf8');
  }

  it('parses implicit and explicit resume flags', () => {
    expect(parseResumeFlagIntent(['-r'])).toEqual({ implicit: true });
    expect(parseResumeFlagIntent(['--resume'])).toEqual({ implicit: true });
    expect(parseResumeFlagIntent(['--resume', 'abc123'])).toEqual({
      implicit: false,
      explicitSessionId: 'abc123',
    });
    expect(parseResumeFlagIntent(['--resume=xyz'])).toEqual({
      implicit: false,
      explicitSessionId: 'xyz',
    });
    expect(parseResumeFlagIntent(['hello'])).toBeNull();
  });

  it('defaults to the native lane when no account/default mapping exists', async () => {
    writeConfig([
      'version: 12',
      'accounts: {}',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);

    const lane = await resolveConfiguredPlainCcsResumeLane();
    expect(lane.kind).toBe('native');
    expect(lane.configDir).toBe(path.join(tempHome, '.claude'));
  });

  it('resolves the plain ccs lane to a default account when configured', async () => {
    writeConfig([
      'version: 12',
      'default: work',
      'accounts:',
      '  work:',
      '    created: "2026-04-04T00:00:00.000Z"',
      '    context_mode: shared',
      '    context_group: default',
      '    continuity_mode: deeper',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);

    const lane = await resolveConfiguredPlainCcsResumeLane();
    expect(lane.kind).toBe('account-default');
    expect(lane.accountName).toBe('work');
    expect(lane.configDir).toBe(path.join(tempHome, '.ccs', 'instances', 'work'));
  });

  it('resolves the plain ccs lane to inherited account continuity when configured', async () => {
    writeConfig([
      'version: 12',
      'accounts:',
      '  work:',
      '    created: "2026-04-04T00:00:00.000Z"',
      '    context_mode: shared',
      '    context_group: default',
      '    continuity_mode: deeper',
      'profiles: {}',
      'continuity:',
      '  inherit_from_account:',
      '    default: work',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);

    const lane = await resolveConfiguredPlainCcsResumeLane();
    expect(lane.kind).toBe('account-inherited');
    expect(lane.accountName).toBe('work');
    expect(lane.configDir).toBe(path.join(tempHome, '.ccs', 'instances', 'work'));
  });

  it('resolves a non-account default profile through continuity inheritance', async () => {
    writeConfig([
      'version: 12',
      'default: glm',
      'accounts:',
      '  work:',
      '    created: "2026-04-04T00:00:00.000Z"',
      'profiles:',
      '  glm:',
      '    type: api',
      '    settings: ~/.ccs/glm.settings.json',
      'continuity:',
      '  inherit_from_account:',
      '    glm: work',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);

    const lane = await resolveConfiguredPlainCcsResumeLane();
    expect(lane.kind).toBe('account-inherited');
    expect(lane.accountName).toBe('work');
  });

  it('finds an explicit session in native and account resume lanes', () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    writeConfig([
      'version: 12',
      'accounts:',
      '  work:',
      '    created: "2026-04-04T00:00:00.000Z"',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);
    const nativeProject = path.join(tempHome, '.claude', 'projects', 'workspace');
    const accountProject = path.join(
      tempHome,
      '.ccs',
      'instances',
      'work',
      'projects',
      'workspace'
    );
    fs.mkdirSync(nativeProject, { recursive: true });
    fs.mkdirSync(accountProject, { recursive: true });
    fs.writeFileSync(path.join(nativeProject, `${sessionId}.jsonl`), '{}\n');
    fs.writeFileSync(path.join(accountProject, `${sessionId}.jsonl`), '{}\n');

    expect(findResumeSessionLanes(sessionId)).toEqual([
      { kind: 'native', configDir: path.join(tempHome, '.claude') },
      {
        kind: 'account',
        configDir: path.join(tempHome, '.ccs', 'instances', 'work'),
        accountName: 'work',
      },
    ]);
  });

  it('does not interpret resume search text as a session filename', () => {
    expect(findResumeSessionLanes('../../settings')).toEqual([]);
  });

  it('does not follow a symlinked project directory outside the native lane', () => {
    const sessionId = '77777777-7777-4777-8777-777777777777';
    writeConfig([
      'version: 12',
      'accounts: {}',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);
    const externalProject = path.join(tempHome, 'external-project');
    const nativeProjects = path.join(tempHome, '.claude', 'projects');
    fs.mkdirSync(externalProject, { recursive: true });
    fs.mkdirSync(nativeProjects, { recursive: true });
    fs.writeFileSync(path.join(externalProject, `${sessionId}.jsonl`), '{}\n');
    fs.symlinkSync(externalProject, path.join(nativeProjects, 'linked-project'));

    expect(findResumeSessionLanes(sessionId)).toEqual([]);
  });

  it('does not follow a symlinked projects root outside the native lane', () => {
    const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    writeConfig([
      'version: 12',
      'accounts: {}',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);
    const externalProject = path.join(tempHome, 'external-projects', 'workspace');
    const nativeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(externalProject, { recursive: true });
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.writeFileSync(path.join(externalProject, `${sessionId}.jsonl`), '{}\n');
    fs.symlinkSync(path.dirname(externalProject), path.join(nativeDir, 'projects'));

    expect(findResumeSessionLanes(sessionId)).toEqual([]);
  });

  it('does not follow a symlinked native config root', () => {
    const sessionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    writeConfig([
      'version: 12',
      'accounts: {}',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);
    const externalProject = path.join(tempHome, 'external-claude', 'projects', 'workspace');
    fs.mkdirSync(externalProject, { recursive: true });
    fs.writeFileSync(path.join(externalProject, `${sessionId}.jsonl`), '{}\n');
    fs.symlinkSync(path.join(tempHome, 'external-claude'), path.join(tempHome, '.claude'));

    expect(findResumeSessionLanes(sessionId)).toEqual([]);
  });

  it('rejects a project parent swapped to an external symlink at the open boundary', () => {
    const sessionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    writeConfig([
      'version: 12',
      'accounts: {}',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);
    const nativeProject = path.join(tempHome, '.claude', 'projects', 'workspace');
    const displacedProject = path.join(tempHome, 'displaced-project');
    const externalProject = path.join(tempHome, 'external-project');
    fs.mkdirSync(nativeProject, { recursive: true });
    fs.mkdirSync(externalProject, { recursive: true });
    fs.writeFileSync(path.join(nativeProject, `${sessionId}.jsonl`), 'native\n');
    fs.writeFileSync(path.join(externalProject, `${sessionId}.jsonl`), 'external\n');
    let swapped = false;

    expect(
      findResumeSessionLanes(sessionId, {
        beforeSessionOpen: () => {
          if (swapped) return;
          swapped = true;
          fs.renameSync(nativeProject, displacedProject);
          fs.symlinkSync(externalProject, nativeProject);
        },
      })
    ).toEqual([]);
  });

  it('does not follow a symlinked session file outside the native lane', () => {
    const sessionId = '88888888-8888-4888-8888-888888888888';
    writeConfig([
      'version: 12',
      'accounts: {}',
      'profiles: {}',
      'cliproxy:',
      '  oauth_accounts: {}',
      '  providers: {}',
      '  variants: {}',
    ]);
    const nativeProject = path.join(tempHome, '.claude', 'projects', 'workspace');
    const externalSession = path.join(tempHome, 'external-session.jsonl');
    fs.mkdirSync(nativeProject, { recursive: true });
    fs.writeFileSync(externalSession, '{}\n');
    fs.symlinkSync(externalSession, path.join(nativeProject, `${sessionId}.jsonl`));

    expect(findResumeSessionLanes(sessionId)).toEqual([]);
  });
});
