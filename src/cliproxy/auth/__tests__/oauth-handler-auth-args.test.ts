import { describe, expect, it } from 'bun:test';
import { buildOAuthArgs } from '../oauth-cli-args';

describe('buildOAuthArgs capability negotiation', () => {
  it('uses the advertised Gemini login flag when supported', () => {
    expect(
      buildOAuthArgs('gemini', '/tmp/cliproxy-config.yaml', false, false, {
        advertisedFlags: new Set(['--login']),
      })
    ).toEqual(['--config', '/tmp/cliproxy-config.yaml', '--login']);
  });

  it('uses the legacy Kiro Google alias when the binary only advertises it', () => {
    expect(
      buildOAuthArgs('kiro', '/tmp/path with spaces/cliproxy config.yaml', false, false, {
        kiroMethod: 'google',
        advertisedFlags: new Set(['--kiro-login']),
      })
    ).toEqual(['--config', '/tmp/path with spaces/cliproxy config.yaml', '--kiro-login']);
  });

  it('fails early when Gemini login is unsupported by the installed binary', () => {
    expect(() =>
      buildOAuthArgs('gemini', '/tmp/cliproxy-config.yaml', false, false, {
        backend: 'original',
        advertisedFlags: new Set(['--codex-login']),
      })
    ).toThrow('cliproxy.backend: original');
  });

  it('preserves Windows config paths as a separate argv entry', () => {
    const args = buildOAuthArgs(
      'gemini',
      'C:\\Users\\Kai Tran\\AppData\\Roaming\\CCS\\cliproxy config.yaml',
      true,
      false,
      {
        advertisedFlags: new Set(['--login']),
      }
    );

    expect(args[1]).toBe('C:\\Users\\Kai Tran\\AppData\\Roaming\\CCS\\cliproxy config.yaml');
    expect(args).toContain('--no-browser');
  });
});
