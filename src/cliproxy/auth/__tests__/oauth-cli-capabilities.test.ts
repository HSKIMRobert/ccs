import { describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import {
  extractAdvertisedCliFlags,
  getOAuthFlagCandidatesForProvider,
  OAUTH_HELP_PROBE_TIMEOUT_MS,
  probeCliProxyAdvertisedFlags,
  resolveAdvertisedAuthFlag,
} from '../oauth-cli-capabilities';

describe('oauth CLI capability probing', () => {
  it('extracts advertised flags from Go help output', () => {
    const flags = extractAdvertisedCliFlags(`
Usage of cli-proxy-api-plus
  -login
    Login Google Account
  -codex-login
    Login to Codex using OAuth
`);

    expect(flags.has('--login')).toBe(true);
    expect(flags.has('--codex-login')).toBe(true);
  });

  it('falls back to the legacy Kiro Google alias when advertised', () => {
    const selected = resolveAdvertisedAuthFlag(
      'kiro',
      getOAuthFlagCandidatesForProvider('kiro', 'google'),
      new Set(['--kiro-login'])
    );

    expect(selected).toBe('--kiro-login');
  });

  it('probes help with a raw argv array so paths with spaces stay intact', () => {
    const spawnSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: '  -login\n',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    });

    try {
      const binaryPath = 'C:\\Program Files\\CCS\\cli-proxy-api-plus.exe';
      const flags = probeCliProxyAdvertisedFlags(binaryPath);

      expect(flags.has('--login')).toBe(true);
      expect(spawnSpy).toHaveBeenCalledWith(
        binaryPath,
        ['--help'],
        expect.objectContaining({
          encoding: 'utf8',
          shell: false,
          timeout: OAUTH_HELP_PROBE_TIMEOUT_MS,
          windowsHide: true,
        })
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  it('fails fast when help probing times out', () => {
    const spawnSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      pid: 0,
      output: [],
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync timed out'), { code: 'ETIMEDOUT' }),
    });

    try {
      expect(() => probeCliProxyAdvertisedFlags('/tmp/cli-proxy-api')).toThrow(
        `Timed out after ${OAUTH_HELP_PROBE_TIMEOUT_MS}ms`
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
