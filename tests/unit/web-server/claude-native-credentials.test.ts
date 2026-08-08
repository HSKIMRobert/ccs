/**
 * Tests for the native Claude Code credential reader.
 *
 * All fs / Keychain access is injected, so these tests never touch the real
 * filesystem or pop a macOS Keychain prompt.
 */

import { describe, expect, it } from 'bun:test';
import {
  readClaudeCredentials,
  readClaudeCredentialsForConfigDir,
  claudeKeychainServiceForConfigDir,
  getAccessToken,
  getSubscriptionTier,
  hasSupportedSubscription,
  type ClaudeNativeCredentials,
} from '../../../src/web-server/usage/claude-native-credentials';

function makeCreds(overrides: Record<string, unknown> = {}): ClaudeNativeCredentials {
  return {
    claudeAiOauth: {
      accessToken: 'tok-abc',
      subscriptionType: 'max',
      ...overrides,
    },
  };
}

describe('readClaudeCredentials', () => {
  it('parses the on-disk credentials file when present (file-first, no Keychain)', () => {
    let keychainCalled = false;
    const creds = readClaudeCredentials({
      platform: 'darwin',
      homedir: '/home/test',
      existsSyncImpl: () => true,
      readFileSyncImpl: () => JSON.stringify(makeCreds()),
      execSyncImpl: () => {
        keychainCalled = true;
        return '';
      },
    });
    expect(creds?.claudeAiOauth?.accessToken).toBe('tok-abc');
    // File present means the Keychain must NOT be consulted (avoids prompt).
    expect(keychainCalled).toBe(false);
  });

  it('falls back to the macOS Keychain when the file is absent', () => {
    const creds = readClaudeCredentials({
      platform: 'darwin',
      homedir: '/home/test',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => {
        throw new Error('should not read file');
      },
      execSyncImpl: () => JSON.stringify(makeCreds({ subscriptionType: 'pro' })),
    });
    expect(creds?.claudeAiOauth?.subscriptionType).toBe('pro');
  });

  it('returns null when both file and Keychain are absent', () => {
    const creds = readClaudeCredentials({
      platform: 'darwin',
      homedir: '/home/test',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => {
        throw new Error('no file');
      },
      execSyncImpl: () => {
        throw new Error('no keychain entry');
      },
    });
    expect(creds).toBeNull();
  });

  it('does not consult the Keychain on non-darwin platforms', () => {
    let keychainCalled = false;
    const creds = readClaudeCredentials({
      platform: 'linux',
      homedir: '/home/test',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => {
        throw new Error('no file');
      },
      execSyncImpl: () => {
        keychainCalled = true;
        return '';
      },
    });
    expect(creds).toBeNull();
    expect(keychainCalled).toBe(false);
  });
});

describe('hasSupportedSubscription', () => {
  it.each(['', 'free', 'none'])('returns false for unsupported subscriptionType %p', (sub) => {
    expect(hasSupportedSubscription(makeCreds({ subscriptionType: sub }))).toBe(false);
  });

  it.each(['max', 'pro', 'team', 'enterprise'])(
    'returns true for supported subscriptionType %p',
    (sub) => {
      expect(hasSupportedSubscription(makeCreds({ subscriptionType: sub }))).toBe(true);
    }
  );

  it('returns true via rateLimitTier regex when subscriptionType is empty', () => {
    const creds = makeCreds({ subscriptionType: '', rateLimitTier: 'claude_max_20x' });
    expect(hasSupportedSubscription(creds)).toBe(true);
  });

  it('returns false for null credentials', () => {
    expect(hasSupportedSubscription(null)).toBe(false);
  });
});

describe('token + tier extraction', () => {
  it('getAccessToken returns the token or null', () => {
    expect(getAccessToken(makeCreds())).toBe('tok-abc');
    expect(getAccessToken(makeCreds({ accessToken: '' }))).toBeNull();
    expect(getAccessToken(null)).toBeNull();
  });

  it('getSubscriptionTier returns the tier or null', () => {
    expect(getSubscriptionTier(makeCreds({ subscriptionType: 'max' }))).toBe('max');
    expect(getSubscriptionTier(makeCreds({ subscriptionType: '' }))).toBeNull();
    expect(getSubscriptionTier(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-config-dir credential reading (isolated `ccs auth` profiles on macOS)
//
// Claude Code stores OAuth credentials for a non-default CLAUDE_CONFIG_DIR in
// a per-directory Keychain item: service "Claude Code-credentials-<hash>",
// where <hash> is the first 8 hex chars of sha256(configDir). These tests pin
// that derivation and the file-first / Keychain-fallback read order.
// ---------------------------------------------------------------------------

describe('claudeKeychainServiceForConfigDir', () => {
  it('derives the service name from sha256 of the config dir path (first 8 hex chars)', () => {
    // sha256("/home/test/.ccs/instances/work") = ffeb4b45...
    expect(claudeKeychainServiceForConfigDir('/home/test/.ccs/instances/work')).toBe(
      'Claude Code-credentials-ffeb4b45'
    );
  });
});

describe('readClaudeCredentialsForConfigDir', () => {
  const configDir = '/home/test/.ccs/instances/work';
  const credFile = `${configDir}/.credentials.json`;

  it('reads <configDir>/.credentials.json when present (file-first, no Keychain)', () => {
    let keychainCalled = false;
    const creds = readClaudeCredentialsForConfigDir(configDir, {
      platform: 'darwin',
      existsSyncImpl: (p: string) => p === credFile,
      readFileSyncImpl: (p: string) => {
        expect(p).toBe(credFile);
        return JSON.stringify(makeCreds());
      },
      execSyncImpl: () => {
        keychainCalled = true;
        return '';
      },
    });
    expect(creds?.claudeAiOauth?.accessToken).toBe('tok-abc');
    expect(keychainCalled).toBe(false);
  });

  it('falls back to the per-config-dir Keychain service when the file is absent', () => {
    let keychainCmd = '';
    const creds = readClaudeCredentialsForConfigDir(configDir, {
      platform: 'darwin',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => {
        throw new Error('should not read file');
      },
      execSyncImpl: (cmd: string) => {
        keychainCmd = cmd;
        return JSON.stringify(makeCreds({ subscriptionType: 'team' }));
      },
    });
    expect(creds?.claudeAiOauth?.subscriptionType).toBe('team');
    expect(keychainCmd).toContain('Claude Code-credentials-ffeb4b45');
  });

  it('returns null when both file and Keychain are absent', () => {
    const creds = readClaudeCredentialsForConfigDir(configDir, {
      platform: 'darwin',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => {
        throw new Error('no file');
      },
      execSyncImpl: () => {
        throw new Error('no keychain entry');
      },
    });
    expect(creds).toBeNull();
  });

  it('does not consult the Keychain on non-darwin platforms', () => {
    let keychainCalled = false;
    const creds = readClaudeCredentialsForConfigDir(configDir, {
      platform: 'linux',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => {
        throw new Error('no file');
      },
      execSyncImpl: () => {
        keychainCalled = true;
        return '';
      },
    });
    expect(creds).toBeNull();
    expect(keychainCalled).toBe(false);
  });
});
