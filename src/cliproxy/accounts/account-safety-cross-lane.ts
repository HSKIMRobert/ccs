/**
 * Cross-lane email overlap guard
 *
 * The documented ban vector: one Google/Anthropic account active in BOTH a
 * CLIProxy OAuth lane AND a native Claude Code profile lane simultaneously.
 * CLIProxy refreshes tokens server-side while the native profile may be logged
 * in via the same account, creating concurrent token usage patterns that
 * Google/Anthropic treat as suspicious.
 *
 * Scope of check: compare the newly registered CLIProxy account email against
 * the email of the currently active native Claude Code profile (via `claude
 * auth status`).  The profiles.json v3.0 schema removed the email field,
 * so we rely on the live auth status command which is already used by
 * quota-fetcher-claude.ts.
 *
 * This guard is advisory only: it warns on stderr but does not block the add.
 * The user may intentionally separate accounts; a false positive is less harmful
 * than silently allowing a true overlap.
 */

import { warn } from '../../utils/ui';
import { getClaudeAuthStatus } from '../../utils/claude-detector';
import { maskEmail } from './account-safety';
import type { CLIProxyProvider } from '../types';

/** Providers where CLIProxy OAuth could create a cross-lane conflict with native Claude */
const CROSS_LANE_RISK_PROVIDERS: CLIProxyProvider[] = ['claude', 'agy', 'gemini', 'codex'];

/**
 * Check whether the newly added CLIProxy account email matches the email of
 * the currently active native Claude Code profile.
 *
 * Emits a warning to stderr if an overlap is detected.  Silent on errors
 * (CLI not found, not logged in, etc.) — the check is best-effort.
 *
 * @param provider - The CLIProxy provider being added
 * @param email    - Email address of the account that was just registered
 */
export function checkCrossLaneEmailOverlap(provider: CLIProxyProvider, email: string): void {
  if (!CROSS_LANE_RISK_PROVIDERS.includes(provider)) return;

  try {
    const status = getClaudeAuthStatus();
    if (!status?.loggedIn || !status.email) return;

    const normalized = email.toLowerCase().trim();
    const nativeNormalized = status.email.toLowerCase().trim();

    if (normalized !== nativeNormalized) return;

    const masked = maskEmail(email);
    const nativeMasked = maskEmail(status.email);

    console.error('');
    console.error(warn(`Account safety: cross-lane email overlap detected for ${provider}`));
    console.error(`    CLIProxy account: ${masked} (${provider})`);
    console.error(`    Native Claude Code profile: ${nativeMasked} (logged in)`);
    console.error(
      '    Same account active in both CLIProxy and native Claude lanes is a known ban risk.'
    );
    console.error(
      '    CLIProxy refreshes tokens server-side; native Claude may do the same concurrently.'
    );
    console.error('    If you want to keep access, use separate accounts for each lane.');
    console.error(
      '    CCS is provided as-is and cannot take responsibility for access-loss decisions.'
    );
    console.error('');
  } catch {
    // Silent: CLI not installed, spawn failed, JSON parse error, etc.
  }
}
