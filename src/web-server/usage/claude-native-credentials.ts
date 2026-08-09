/**
 * Native Claude Code credential reader.
 *
 * Reads the LOGGED-IN Claude Code OAuth token so the bar can show the user's
 * own subscription quota (Max/Pro/Team) without going through CLIProxy-managed
 * auth files.
 *
 * File-first, Keychain-fallback: we read ~/.claude/.credentials.json directly
 * because hitting the macOS Keychain pops a permission dialog. The Keychain
 * fallback is load-bearing on machines where Claude Code stores the token there
 * instead of on disk, so it must be kept even though the file path is preferred.
 *
 * Only the user's own token is read here; the single read-only Anthropic usage
 * endpoint is the only thing that ever sees it (see native-quota-collector).
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

/** Shape of the relevant slice of ~/.claude/.credentials.json */
export interface ClaudeNativeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    subscriptionType?: string;
    rateLimitTier?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Injectable seams so unit tests never touch the real fs/Keychain. */
export interface CredentialReaderDeps {
  platform?: NodeJS.Platform;
  homedir?: string;
  existsSyncImpl?: (p: string) => boolean;
  readFileSyncImpl?: (p: string) => string;
  execFileImpl?: ExecFileImpl;
  keychainTimeoutMs?: number;
}

type ExecFileCallback = (error: Error | null, stdout: string | Buffer) => void;
type ExecFileImpl = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
  callback: ExecFileCallback
) => { kill?: () => void } | void;

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const SECURITY_PATH = '/usr/bin/security';
const KEYCHAIN_TIMEOUT_MS = 5000;

/** Subscription types that mean "no real subscription" -> skip the fetch. */
const UNSUPPORTED_SUBSCRIPTION_TYPES = new Set(['', 'free', 'none']);

/** rateLimitTier values that imply an entitled subscription. */
const SUPPORTED_RATE_LIMIT_TIER = /claude|max|pro|team|enterprise/;

function parseCredentials(raw: string): ClaudeNativeCredentials | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ClaudeNativeCredentials;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Read the native Claude Code credentials.
 *
 * Order: the on-disk credentials file first (no prompt), then the macOS
 * Keychain as a fallback. Returns null when neither source yields a parseable
 * object.
 */
export async function readClaudeCredentials(
  deps: CredentialReaderDeps = {}
): Promise<ClaudeNativeCredentials | null> {
  const platform = deps.platform ?? os.platform();
  const homedir = deps.homedir ?? os.homedir();
  const existsImpl = deps.existsSyncImpl ?? existsSync;
  const readImpl = deps.readFileSyncImpl ?? ((p: string) => readFileSync(p, 'utf8'));

  const credentialsPath = path.join(homedir, '.claude', '.credentials.json');
  if (existsImpl(credentialsPath)) {
    try {
      const parsed = parseCredentials(readImpl(credentialsPath));
      if (parsed) return parsed;
    } catch {
      // fall through to Keychain
    }
  }

  if (platform === 'darwin') {
    const parsed = await readCredentialsFromKeychainService(KEYCHAIN_SERVICE, deps);
    if (parsed) return parsed;
  }

  return null;
}

/** Read + parse one Keychain generic-password item. Returns null on any failure. */
async function readCredentialsFromKeychainService(
  service: string,
  deps: CredentialReaderDeps
): Promise<ClaudeNativeCredentials | null> {
  const timeoutMs = deps.keychainTimeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  const execImpl: ExecFileImpl =
    deps.execFileImpl ??
    ((file, args, options, callback) =>
      execFile(file, [...args], options, (error, stdout) => callback(error, stdout)));

  return new Promise((resolve) => {
    let settled = false;
    let child: { kill?: () => void } | void;
    const finish = (credentials: ClaudeNativeCredentials | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(credentials);
    };
    const timer = setTimeout(() => {
      child?.kill?.();
      finish(null);
    }, timeoutMs);
    try {
      child = execImpl(
        SECURITY_PATH,
        ['find-generic-password', '-s', service, '-w'],
        {
          timeout: timeoutMs,
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          if (error) return finish(null);
          const raw = (typeof stdout === 'string' ? stdout : stdout.toString('utf8')).trim();
          finish(raw ? parseCredentials(raw) : null);
        }
      );
    } catch {
      finish(null);
    }
  });
}

/**
 * Keychain service name Claude Code uses for a non-default CLAUDE_CONFIG_DIR:
 * "Claude Code-credentials-<first 8 hex chars of sha256(configDir)>".
 */
export function claudeKeychainServiceForConfigDir(configDir: string): string {
  const hash = crypto.createHash('sha256').update(configDir).digest('hex').slice(0, 8);
  return `${KEYCHAIN_SERVICE}-${hash}`;
}

/**
 * Read the Claude Code credentials for a specific CLAUDE_CONFIG_DIR (e.g. an
 * isolated `ccs auth` instance directory).
 *
 * File-first (<configDir>/.credentials.json, no prompt), then the macOS
 * Keychain item derived from the config dir path. On macOS Claude Code stores
 * OAuth tokens in the Keychain by default, so without the Keychain fallback
 * every isolated profile looks permanently logged-out to the bar.
 */
export async function readClaudeCredentialsForConfigDir(
  configDir: string,
  deps: CredentialReaderDeps = {}
): Promise<ClaudeNativeCredentials | null> {
  const platform = deps.platform ?? os.platform();
  const existsImpl = deps.existsSyncImpl ?? existsSync;
  const readImpl = deps.readFileSyncImpl ?? ((p: string) => readFileSync(p, 'utf8'));

  const credentialsPath = path.join(configDir, '.credentials.json');
  if (existsImpl(credentialsPath)) {
    try {
      const parsed = parseCredentials(readImpl(credentialsPath));
      if (parsed) return parsed;
    } catch {
      // fall through to Keychain
    }
  }

  if (platform === 'darwin') {
    return readCredentialsFromKeychainService(claudeKeychainServiceForConfigDir(configDir), deps);
  }

  return null;
}

/** Pull the OAuth access token, or null when absent. */
export function getAccessToken(creds: ClaudeNativeCredentials | null): string | null {
  const token = creds?.claudeAiOauth?.accessToken;
  return typeof token === 'string' && token.trim().length > 0 ? token : null;
}

/** Pull the subscription tier (e.g. "max" / "pro"), or null. */
export function getSubscriptionTier(creds: ClaudeNativeCredentials | null): string | null {
  const tier = creds?.claudeAiOauth?.subscriptionType;
  return typeof tier === 'string' && tier.trim().length > 0 ? tier.trim() : null;
}

/**
 * True when the credentials describe a real, entitled subscription.
 *
 * Gating on this BEFORE fetching means a free/logged-out user never spends a
 * token call against the hostile usage endpoint and never gets a phantom row.
 */
export function hasSupportedSubscription(creds: ClaudeNativeCredentials | null): boolean {
  const subscriptionType = String(creds?.claudeAiOauth?.subscriptionType ?? '')
    .trim()
    .toLowerCase();
  if (subscriptionType && !UNSUPPORTED_SUBSCRIPTION_TYPES.has(subscriptionType)) {
    return true;
  }

  const rateLimitTier = String(creds?.claudeAiOauth?.rateLimitTier ?? '')
    .trim()
    .toLowerCase();
  return SUPPORTED_RATE_LIMIT_TIER.test(rateLimitTier);
}
