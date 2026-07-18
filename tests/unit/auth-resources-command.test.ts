import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import ProfileRegistry from '../../src/auth/profile-registry';
import InstanceManager from '../../src/management/instance-manager';
import { handleResources } from '../../src/auth/commands/resources-command';
import { handleCreate } from '../../src/auth/commands/create-command';
import { handleList } from '../../src/auth/commands/list-command';
import { handleShow } from '../../src/auth/commands/show-command';
import { handleBackup } from '../../src/auth/commands/backup-command';
import { handleRemove } from '../../src/auth/commands/remove-command';
import { handleDefault, handleResetDefault } from '../../src/auth/commands/default-command';

async function expectProfileExit(action: () => Promise<void>): Promise<string> {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];

  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as typeof process.exit;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  try {
    await expect(action()).rejects.toThrow('process.exit(7)');
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return lines.join('\n');
}

describe('auth resources command', () => {
  let tempRoot = '';
  let originalCcsHome: string | undefined;
  let originalUnifiedMode: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-auth-resources-'));
    originalCcsHome = process.env.CCS_HOME;
    originalUnifiedMode = process.env.CCS_UNIFIED_CONFIG;

    process.env.CCS_HOME = tempRoot;
    process.env.CCS_UNIFIED_CONFIG = '1';
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;

    if (originalUnifiedMode !== undefined) process.env.CCS_UNIFIED_CONFIG = originalUnifiedMode;
    else delete process.env.CCS_UNIFIED_CONFIG;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('updates an existing account shared resource mode without changing context metadata', async () => {
    const ccsDir = path.join(tempRoot, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 8',
        'accounts:',
        '  work:',
        '    created: "2026-02-01T00:00:00.000Z"',
        '    last_used: null',
        '    context_mode: shared',
        '    context_group: sprint-a',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: {}',
        '  variants: {}',
      ].join('\n'),
      'utf8'
    );

    const registry = new ProfileRegistry();
    const instanceMgr = new InstanceManager();
    const ensureSpy = spyOn(InstanceManager.prototype, 'ensureInstance').mockResolvedValue(
      path.join(ccsDir, 'instances', 'work')
    );
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };

    try {
      await handleResources(
        {
          registry,
          instanceMgr,
          version: 'test',
        },
        ['work', '--mode', 'profile-local', '--json']
      );
    } finally {
      console.log = originalLog;
      ensureSpy.mockRestore();
    }

    const output = JSON.parse(lines.join('\n')) as {
      shared_resource_mode: string;
      bare?: boolean;
    };
    expect(output.shared_resource_mode).toBe('profile-local');
    expect(output.bare).toBe(true);

    const account = registry.getAllAccountsUnified().work;
    expect(account.shared_resource_mode).toBe('profile-local');
    expect(account.bare).toBe(true);
    expect(account.context_mode).toBe('shared');
    expect(account.context_group).toBe('sprint-a');
  });

  it('rolls back inferred shared metadata when instance reconciliation fails', async () => {
    const ccsDir = path.join(tempRoot, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 8',
        'accounts:',
        '  work:',
        '    created: "2026-02-01T00:00:00.000Z"',
        '    last_used: null',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: {}',
        '  variants: {}',
      ].join('\n'),
      'utf8'
    );

    const registry = new ProfileRegistry();
    const instanceMgr = new InstanceManager();
    const ensureSpy = spyOn(InstanceManager.prototype, 'ensureInstance').mockRejectedValue(
      new Error('reconcile failed')
    );

    try {
      await expect(
        handleResources(
          {
            registry,
            instanceMgr,
            version: 'test',
          },
          ['work', '--mode', 'profile-local']
        )
      ).rejects.toThrow('reconcile failed');
    } finally {
      ensureSpy.mockRestore();
    }

    const account = registry.getAllAccountsUnified().work;
    expect(account.shared_resource_mode).toBeUndefined();
    expect(account.bare).toBeUndefined();
  });

  it('rejects resources --mode without a value instead of showing current mode', async () => {
    const ccsDir = path.join(tempRoot, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 8',
        'accounts:',
        '  work:',
        '    created: "2026-02-01T00:00:00.000Z"',
        '    last_used: null',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: {}',
        '  variants: {}',
      ].join('\n'),
      'utf8'
    );

    const registry = new ProfileRegistry();
    const instanceMgr = new InstanceManager();

    const output = await expectProfileExit(() =>
      handleResources(
        {
          registry,
          instanceMgr,
          version: 'test',
        },
        ['work', '--mode']
      )
    );

    expect(output).toContain('Missing value for --mode: expected shared|profile-local');
  });

  it('rejects --mode on auth create instead of silently ignoring it', async () => {
    const registry = new ProfileRegistry();
    const instanceMgr = new InstanceManager();

    const output = await expectProfileExit(() =>
      handleCreate(
        {
          registry,
          instanceMgr,
          version: 'test',
        },
        ['work', '--mode', 'profile-local']
      )
    );

    expect(output).toContain('Unknown option(s): "--mode"');
  });

  it('rejects reserved xai and grok account profile names on auth create', async () => {
    for (const profileName of ['xai', 'GROK']) {
      const registry = new ProfileRegistry();
      const instanceMgr = new InstanceManager();

      const output = await expectProfileExit(() =>
        handleCreate(
          {
            registry,
            instanceMgr,
            version: 'test',
          },
          [profileName]
        )
      );

      expect(output).toContain('Invalid profile name');
      expect(registry.hasAccountUnified(profileName)).toBe(false);
    }
  });

  it('rejects --force for an absent reserved account profile', async () => {
    const registry = new ProfileRegistry();
    const instanceMgr = new InstanceManager();

    const output = await expectProfileExit(() =>
      handleCreate(
        {
          registry,
          instanceMgr,
          version: 'test',
        },
        ['xai', '--force']
      )
    );

    expect(output).toContain('Invalid profile name');
    expect(registry.hasAccountUnified('xai')).toBe(false);
  });

  it('allows --force to repair an exact existing xai account profile', async () => {
    const ccsDir = path.join(tempRoot, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 12',
        'accounts:',
        '  xai:',
        '    created: "2026-02-01T00:00:00.000Z"',
        '    last_used: null',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: {}',
        '  variants: {}',
      ].join('\n'),
      'utf8'
    );

    const claudeDetector = await import('../../src/utils/claude-detector');
    const cliSpy = spyOn(claudeDetector, 'getClaudeCliInfo').mockReturnValue({
      path: '/usr/bin/claude',
      isWindows: false,
      needsShell: false,
    });
    const child = {
      on: () => child,
    } as unknown as ReturnType<typeof childProcess.spawn>;
    const spawnSpy = spyOn(childProcess, 'spawn').mockReturnValue(child);
    const ensureSpy = spyOn(InstanceManager.prototype, 'ensureInstance').mockResolvedValue(
      path.join(ccsDir, 'instances', 'xai')
    );
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      const registry = new ProfileRegistry();
      const instanceMgr = new InstanceManager();
      await handleCreate(
        {
          registry,
          instanceMgr,
          version: 'test',
        },
        ['xai', '--force']
      );

      expect(spawnSpy).toHaveBeenCalled();
      expect(registry.hasAccountUnified('xai')).toBe(true);
    } finally {
      logSpy.mockRestore();
      ensureSpy.mockRestore();
      spawnSpy.mockRestore();
      cliSpy.mockRestore();
    }
  });

  it('rejects --mode on non-resources auth commands instead of silently ignoring it', async () => {
    const registry = new ProfileRegistry();
    const instanceMgr = new InstanceManager();
    const ctx = { registry, instanceMgr, version: 'test' };
    const cases: Array<[string, () => Promise<void>]> = [
      ['list', () => handleList(ctx, ['--mode', 'shared'])],
      ['show', () => handleShow(ctx, ['work', '--mode=shared'])],
      ['backup', () => handleBackup(ctx, ['work', '--mode', 'profile-local'])],
      ['remove', () => handleRemove(ctx, ['work', '--mode', 'shared'])],
      ['default', () => handleDefault(ctx, ['work', '--mode', 'shared'])],
      ['reset-default', () => handleResetDefault(ctx, ['--mode', 'shared'])],
    ];

    for (const [commandName, action] of cases) {
      const output = await expectProfileExit(action);
      expect(`${commandName}\n${output}`).toContain('Unknown option(s): "--mode"');
    }
  });
});
