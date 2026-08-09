import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Shell } from '../../../src/codex-auth/shell-detect';
import { maybeWarnAboutResumeLaneMismatch } from '../../../src/auth/resume-lane-warning';

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('resume lane warning', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prints guidance when the plain ccs lane differs from the account lane', async () => {
    const logs: string[] = [];

    await maybeWarnAboutResumeLaneMismatch('work', '/tmp/account-lane', ['--resume'], {
      log: (message) => logs.push(message),
      resolvePlainLane: async () => ({
        kind: 'native',
        label: 'native Claude lane',
        configDir: '/tmp/native-lane',
        projectCount: 12,
      }),
    });

    const plainLogs = logs.map((message) => stripAnsi(message));

    expect(plainLogs[0]).toContain('Resume for account "work" will search that account lane');
    expect(plainLogs).toContain('[i]   Account lane: /tmp/account-lane');
    expect(plainLogs).toContain('[i]   Plain ccs lane: native Claude lane (/tmp/native-lane)');
    expect(plainLogs).toContain('[i]   Recover the original lane first: ccs -r');
  });

  it('does not log anything when resume is not requested', async () => {
    const logs: string[] = [];

    await maybeWarnAboutResumeLaneMismatch('work', '/tmp/account-lane', ['hello'], {
      log: (message) => logs.push(message),
      resolvePlainLane: async () => {
        throw new Error('should not be called');
      },
    });

    expect(logs).toHaveLength(0);
  });

  it('swallows diagnostic failures and keeps the warning path non-fatal', async () => {
    const logs: string[] = [];

    await expect(
      maybeWarnAboutResumeLaneMismatch('work', '/tmp/account-lane', ['-r'], {
        debug: true,
        log: (message) => logs.push(message),
        resolvePlainLane: async () => {
          throw new Error('broken config');
        },
      })
    ).resolves.toBeUndefined();

    expect(logs[0]).toContain('Resume lane guidance skipped because diagnostics failed');
    expect(logs[1]).toContain('Diagnostic error: broken config');
  });

  it('does not warn when an explicit session already exists in the target account lane', async () => {
    const logs: string[] = [];

    await maybeWarnAboutResumeLaneMismatch(
      'work',
      '/tmp/account-lane',
      ['--resume', '11111111-1111-4111-8111-111111111111'],
      {
        log: (message) => logs.push(message),
        resolvePlainLane: async () => ({
          kind: 'native',
          label: 'native Claude lane',
          configDir: '/tmp/native-lane',
          projectCount: 12,
        }),
        findSessionLanes: () => [
          {
            kind: 'account',
            configDir: '/tmp/account-lane',
            accountName: 'work',
          },
        ],
      }
    );

    expect(logs).toHaveLength(0);
  });

  it('points an explicit session at its unique account lane', async () => {
    const logs: string[] = [];
    const sessionId = '22222222-2222-4222-8222-222222222222';

    await maybeWarnAboutResumeLaneMismatch(
      'personal',
      '/tmp/personal-lane',
      ['--resume', sessionId],
      {
        log: (message) => logs.push(message),
        resolvePlainLane: async () => ({
          kind: 'native',
          label: 'native Claude lane',
          configDir: '/tmp/native-lane',
          projectCount: 12,
        }),
        findSessionLanes: () => [
          {
            kind: 'account',
            configDir: '/tmp/work-lane',
            accountName: 'work',
          },
        ],
      }
    );

    const plainLogs = logs.map((message) => stripAnsi(message));
    expect(plainLogs).toContain(
      `[i]   Resume from the lane that owns this session: ccs work --resume ${sessionId}`
    );
    expect(plainLogs).toContain(
      '[i]   Back up that lane before changing setup: ccs auth backup work'
    );
    expect(plainLogs).not.toContain('[i]   Recover the original lane first: ccs -r');
    expect(plainLogs).not.toContain(
      '[i]   For future work, align plain ccs with this account: ccs auth default personal'
    );
  });

  it('lists ambiguous source lanes without choosing or merging one', async () => {
    const logs: string[] = [];
    const sessionId = '44444444-4444-4444-8444-444444444444';

    await maybeWarnAboutResumeLaneMismatch(
      'personal',
      '/tmp/personal-lane',
      ['--resume', sessionId],
      {
        log: (message) => logs.push(message),
        resolvePlainLane: async () => ({
          kind: 'native',
          label: 'native Claude lane',
          configDir: '/tmp/native-lane',
          projectCount: 12,
        }),
        findSessionLanes: () => [
          { kind: 'native', configDir: '/tmp/native-lane' },
          { kind: 'account', configDir: '/tmp/work-lane', accountName: 'work' },
        ],
      }
    );

    const plainLogs = logs.map((message) => stripAnsi(message));
    expect(plainLogs).toContain(
      '[i]   This session exists in multiple lanes; choose one without merging history:'
    );
    expect(plainLogs).toContain(`[i]     ccs --resume ${sessionId}`);
    expect(plainLogs).toContain(`[i]     ccs work --resume ${sessionId}`);
    expect(plainLogs).not.toContain('[i]   Recover the original lane first: ccs -r');
  });

  it('uses explicit native Claude routing when plain ccs defaults to another account', async () => {
    const logs: string[] = [];
    const sessionId = '55555555-5555-4555-8555-555555555555';

    await maybeWarnAboutResumeLaneMismatch(
      'personal',
      '/tmp/personal-lane',
      ['--resume', sessionId],
      {
        log: (message) => logs.push(message),
        resolvePlainLane: async () => ({
          kind: 'account-default',
          label: 'plain ccs defaults to account "work"',
          configDir: '/tmp/work-lane',
          accountName: 'work',
          projectCount: 12,
        }),
        shell: 'bash',
        findSessionLanes: () => [{ kind: 'native', configDir: '/tmp/native-lane' }],
      }
    );

    const plainLogs = logs.map((message) => stripAnsi(message));
    expect(plainLogs).toContain(
      `[i]   Resume from the lane that owns this session: unset ANTHROPIC_BASE_URL; unset ANTHROPIC_AUTH_TOKEN; unset ANTHROPIC_API_KEY; export CLAUDE_CONFIG_DIR='/tmp/native-lane'; claude --resume ${sessionId}`
    );
    expect(plainLogs.some((message) => message.includes(`ccs --resume ${sessionId}`))).toBe(false);
  });

  it('routes to native Claude when the target account is also the plain ccs default', async () => {
    const logs: string[] = [];
    const sessionId = '66666666-6666-4666-8666-666666666666';

    await maybeWarnAboutResumeLaneMismatch('work', '/tmp/work-lane', ['--resume', sessionId], {
      log: (message) => logs.push(message),
      resolvePlainLane: async () => ({
        kind: 'account-default',
        label: 'plain ccs defaults to account "work"',
        configDir: '/tmp/work-lane',
        accountName: 'work',
        projectCount: 12,
      }),
      shell: 'bash',
      findSessionLanes: () => [{ kind: 'native', configDir: '/tmp/native-lane' }],
    });

    const plainLogs = logs.map((message) => stripAnsi(message));
    expect(plainLogs).toContain(
      `[i]   Resume from the lane that owns this session: unset ANTHROPIC_BASE_URL; unset ANTHROPIC_AUTH_TOKEN; unset ANTHROPIC_API_KEY; export CLAUDE_CONFIG_DIR='/tmp/native-lane'; claude --resume ${sessionId}`
    );
    expect(plainLogs.some((message) => message.includes(`ccs --resume ${sessionId}`))).toBe(false);
  });

  it('uses explicit native routing for an ambient lane even when its path matches', async () => {
    const logs: string[] = [];
    const sessionId = '99999999-9999-4999-8999-999999999999';

    await maybeWarnAboutResumeLaneMismatch('work', '/tmp/work-lane', ['--resume', sessionId], {
      log: (message) => logs.push(stripAnsi(message)),
      shell: 'zsh',
      resolvePlainLane: async () => ({
        kind: 'ambient',
        label: 'current shell CLAUDE_CONFIG_DIR',
        configDir: '/tmp/native-lane',
        projectCount: 1,
      }),
      findSessionLanes: () => [{ kind: 'native', configDir: '/tmp/native-lane' }],
    });

    expect(logs.some((message) => message.includes('export CLAUDE_CONFIG_DIR'))).toBe(true);
    expect(logs.some((message) => message.includes(`ccs --resume ${sessionId}`))).toBe(false);
  });

  it.each([
    [
      'bash',
      "unset ANTHROPIC_BASE_URL; unset ANTHROPIC_AUTH_TOKEN; unset ANTHROPIC_API_KEY; export CLAUDE_CONFIG_DIR='/tmp/native lane'; claude --resume",
    ],
    [
      'zsh',
      "unset ANTHROPIC_BASE_URL; unset ANTHROPIC_AUTH_TOKEN; unset ANTHROPIC_API_KEY; export CLAUDE_CONFIG_DIR='/tmp/native lane'; claude --resume",
    ],
    [
      'fish',
      "set -e ANTHROPIC_BASE_URL; set -e ANTHROPIC_AUTH_TOKEN; set -e ANTHROPIC_API_KEY; set -gx CLAUDE_CONFIG_DIR '/tmp/native lane'; claude --resume",
    ],
    [
      'pwsh',
      'Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue; Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue; $env:CLAUDE_CONFIG_DIR = "/tmp/native lane"; claude --resume',
    ],
    [
      'cmd',
      'set "ANTHROPIC_BASE_URL=" && set "ANTHROPIC_AUTH_TOKEN=" && set "ANTHROPIC_API_KEY=" && set "CLAUDE_CONFIG_DIR=/tmp/native lane" && claude --resume',
    ],
  ] as Array<[Shell, string]>)(
    'formats executable native recovery for %s',
    async (shell, prefix) => {
      const logs: string[] = [];
      const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await maybeWarnAboutResumeLaneMismatch('work', '/tmp/work-lane', ['--resume', sessionId], {
        log: (message) => logs.push(stripAnsi(message)),
        shell,
        resolvePlainLane: async () => ({
          kind: 'account-default',
          label: 'plain ccs defaults to account "work"',
          configDir: '/tmp/work-lane',
          accountName: 'work',
          projectCount: 1,
        }),
        findSessionLanes: () => [{ kind: 'native', configDir: '/tmp/native lane' }],
      });
      expect(logs.some((message) => message.includes(`${prefix} ${sessionId}`))).toBe(true);
    }
  );

  it('does not emit executable guidance for an unsafe account name', async () => {
    const logs: string[] = [];
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await maybeWarnAboutResumeLaneMismatch('personal', '/tmp/personal', ['--resume', sessionId], {
      log: (message) => logs.push(stripAnsi(message)),
      shell: 'bash',
      resolvePlainLane: async () => ({
        kind: 'native',
        label: 'native Claude lane',
        configDir: '/tmp/native',
        projectCount: 1,
      }),
      findSessionLanes: () => [
        { kind: 'account', configDir: '/tmp/unsafe', accountName: 'work; touch /tmp/pwned' },
      ],
    });
    expect(logs.some((message) => message.includes('unsafe account name'))).toBe(true);
    expect(logs.some((message) => message.includes('ccs work;'))).toBe(false);
    expect(logs.some((message) => message.includes('backup work;'))).toBe(false);
  });

  it('executes the printed bash route with poisoned provider routing removed', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-resume-command-'));
    temporaryDirectories.push(tempDir);
    const binDir = path.join(tempDir, 'bin');
    const capturePath = path.join(tempDir, 'capture');
    const nativeConfigDir = path.join(tempDir, 'native lane');
    const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    fs.mkdirSync(binDir);
    fs.mkdirSync(path.join(nativeConfigDir, 'projects', 'workspace'), { recursive: true });
    fs.writeFileSync(
      path.join(nativeConfigDir, 'projects', 'workspace', `${sessionId}.jsonl`),
      '{}\n'
    );
    fs.writeFileSync(
      path.join(binDir, 'claude'),
      '#!/bin/sh\nsession_path="$CLAUDE_CONFIG_DIR/projects/workspace/$2.jsonl"\n[ -f "$session_path" ] || exit 9\nprintf "%s|%s|%s|%s|%s|found\\n" "$CLAUDE_CONFIG_DIR" "${ANTHROPIC_BASE_URL-unset}" "${ANTHROPIC_AUTH_TOKEN-unset}" "${ANTHROPIC_API_KEY-unset}" "$*" > "$CAPTURE_PATH"\n',
      { mode: 0o700 }
    );
    const logs: string[] = [];
    await maybeWarnAboutResumeLaneMismatch('work', '/tmp/work', ['--resume', sessionId], {
      log: (message) => logs.push(stripAnsi(message)),
      shell: 'bash',
      resolvePlainLane: async () => ({
        kind: 'account-default',
        label: 'plain ccs defaults to account "work"',
        configDir: '/tmp/work',
        accountName: 'work',
        projectCount: 1,
      }),
      findSessionLanes: () => [{ kind: 'native', configDir: nativeConfigDir }],
    });
    const guidance = logs.find((message) => message.includes('Resume from the lane'))!;
    const command = guidance.slice(guidance.indexOf(': ') + 2);
    const result = spawnSync('/bin/bash', ['-c', command], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        CAPTURE_PATH: capturePath,
        ANTHROPIC_BASE_URL: 'https://poison.invalid',
        ANTHROPIC_AUTH_TOKEN: 'poison-token',
        ANTHROPIC_API_KEY: 'poison-key',
      },
    });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(capturePath, 'utf8').trim()).toBe(
      `${nativeConfigDir}|unset|unset|unset|--resume ${sessionId}|found`
    );
  });
});
