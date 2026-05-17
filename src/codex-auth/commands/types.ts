/**
 * Shared types and utilities for codex-auth command handlers.
 */

import { color } from '../../utils/ui';
import { exitWithError } from '../../errors';
import { ExitCode } from '../../errors/exit-codes';
import type { CodexProfileRegistry } from '../codex-profile-registry';

// Re-export for convenience in command modules
export { formatRelativeTime } from '../../utils/time';

// ── Context ──────────────────────────────────────────────────────────────────

export interface CodexCommandContext {
  registry: CodexProfileRegistry;
  version: string;
}

// ── CLI args ─────────────────────────────────────────────────────────────────

export interface CodexAuthArgs {
  profileName?: string;
  yes?: boolean;
  json?: boolean;
  force?: boolean;
  shell?: string;
  unknownFlags?: string[];
}

// ── Profile output shape (JSON mode) ─────────────────────────────────────────

export interface CodexProfileOutput {
  name: string;
  is_default: boolean;
  is_active: boolean;
  created: string;
  last_used: string | null;
  email: string | null;
  plan: string | null;
  account_id: string | null;
  profile_dir: string;
  auth_json_exists: boolean;
  auth_json_mtime: string | null;
  config_toml_link_target: string | null;
}

// ── Name validation ───────────────────────────────────────────────────────────

const RESERVED = new Set(['default', 'current']);

/**
 * Profile name must match /^[a-z0-9][a-z0-9_-]{0,63}$/ and not be reserved.
 * Rejects uppercase, path separators, leading dash/underscore, length >64.
 */
export function isValidCodexProfileName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (RESERVED.has(name)) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name);
}

export function getProfileNameError(name: string): string | null {
  if (!name) return 'Profile name is required.';
  if (RESERVED.has(name)) return `Profile name "${name}" is reserved.`;
  if (name.includes('/') || name.includes('\\'))
    return 'Profile name must not contain path separators.';
  if (name.length > 64) return 'Profile name must be 64 characters or fewer.';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
    return 'Profile name must match [a-z0-9][a-z0-9_-]{0,63}.';
  return null;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

export function parseArgs(args: string[]): CodexAuthArgs {
  const result: CodexAuthArgs = { unknownFlags: [] };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') {
      result.yes = true;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--shell') {
      result.shell = args[++i];
    } else if (arg.startsWith('--shell=')) {
      result.shell = arg.slice('--shell='.length);
    } else if (arg.startsWith('-') && arg !== '--') {
      if (result.unknownFlags) result.unknownFlags.push(arg);
    } else if (arg !== '--') {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    result.profileName = positional[0];
  }

  return result;
}

export function rejectUnsupportedOptions(parsed: CodexAuthArgs, usage: string): void {
  if (parsed.unknownFlags && parsed.unknownFlags.length > 0) {
    console.log(`Usage: ${color(usage, 'command')}`);
    exitWithError('Unknown options', ExitCode.GENERAL_ERROR);
  }
}
