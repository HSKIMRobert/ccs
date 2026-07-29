import * as childProcess from 'child_process';
import { AuthError, BinaryError } from '../../errors/error-types';
import type { CLIProxyBackend, CLIProxyProvider } from '../types';
import { getKiroCLIAuthFlag, getOAuthConfig, type KiroCLIAuthMethod } from './auth-types';

const HELP_FLAG_PATTERN = /(?:^|\n)\s+-([a-z0-9][a-z0-9-]*)\b/gi;
export const OAUTH_HELP_PROBE_TIMEOUT_MS = 5000;

export function extractAdvertisedCliFlags(helpText: string): Set<string> {
  const flags = new Set<string>();

  for (const match of helpText.matchAll(HELP_FLAG_PATTERN)) {
    const flagName = match[1]?.trim();
    if (!flagName) {
      continue;
    }
    flags.add(`--${flagName}`);
  }

  return flags;
}

export function getOAuthFlagCandidatesForProvider(
  provider: CLIProxyProvider,
  kiroMethod?: KiroCLIAuthMethod
): readonly string[] {
  if (provider !== 'kiro') {
    return [getOAuthConfig(provider).authFlag];
  }

  switch (kiroMethod) {
    case 'google':
      return ['--kiro-google-login', '--kiro-login'];
    case 'aws':
    case 'aws-authcode':
    case 'idc':
      return [getKiroCLIAuthFlag(kiroMethod)];
    default:
      return [getKiroCLIAuthFlag('aws')];
  }
}

export function selectAdvertisedAuthFlag(
  candidates: readonly string[],
  advertisedFlags: ReadonlySet<string>
): string | null {
  for (const candidate of candidates) {
    if (advertisedFlags.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveAdvertisedAuthFlag(
  provider: CLIProxyProvider,
  candidates: readonly string[],
  advertisedFlags: ReadonlySet<string>,
  options: { backend?: CLIProxyBackend } = {}
): string {
  const selected = selectAdvertisedAuthFlag(candidates, advertisedFlags);
  if (selected) {
    return selected;
  }

  const oauthConfig = getOAuthConfig(provider);
  if (provider === 'gemini' && options.backend === 'original') {
    throw new AuthError(
      'Installed CLIProxy binary does not advertise Google Gemini login support (--login). The active `cliproxy.backend: original` runtime cannot start Gemini OAuth from CCS. To use Gemini OAuth, switch `cliproxy.backend` to `plus`, set CLIPROXY_GEMINI_OAUTH_CLIENT_ID and CLIPROXY_GEMINI_OAUTH_CLIENT_SECRET before starting CLIProxy Plus, reinstall the maintained Plus fork, and retry auth.',
      provider
    );
  }

  throw new AuthError(
    `Installed CLIProxy binary does not advertise a supported ${oauthConfig.displayName} login flag (${candidates.join(' or ')}). Run \`ccs cliproxy status\`, then reinstall the active backend binary before retrying auth.`,
    provider
  );
}

export function probeCliProxyAdvertisedFlags(binaryPath: string): Set<string> {
  const result = childProcess.spawnSync(binaryPath, ['--help'], {
    encoding: 'utf8',
    shell: false,
    timeout: OAUTH_HELP_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.error) {
    const errorCode = (result.error as NodeJS.ErrnoException).code;
    if (errorCode === 'ETIMEDOUT') {
      throw new BinaryError(
        `Timed out after ${OAUTH_HELP_PROBE_TIMEOUT_MS}ms while inspecting CLIProxy login capabilities`,
        binaryPath
      );
    }
    throw result.error;
  }

  if (result.signal) {
    throw new BinaryError(
      `CLIProxy capability probe was interrupted while inspecting login capabilities (${result.signal})`,
      binaryPath
    );
  }

  return extractAdvertisedCliFlags(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}
