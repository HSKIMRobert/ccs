/**
 * codex-auth show command.
 * List mode: table of all profiles with STATE column.
 * Detail mode: delegated to show-detail-view.ts.
 * --json: machine-readable output.
 * D14: active(missing) row at top when CCS_CODEX_PROFILE points to deleted profile.
 */

import * as fs from 'fs';
import * as path from 'path';
import { initUI, info, table } from '../../utils/ui';
import { resolveCodexProfileDir } from '../codex-profile-paths';
import { decodeAccountIdentity } from '../codex-account-identity';
import { showProfileDetail } from './show-detail-view';
import { parseArgs, rejectUnsupportedOptions, formatRelativeTime } from './types';
import type { CodexCommandContext, CodexProfileOutput } from './types';

export async function handleShowCodex(ctx: CodexCommandContext, args: string[]): Promise<void> {
  await initUI();
  const parsed = parseArgs(args);
  rejectUnsupportedOptions(parsed, 'ccsx auth show [name] [--json]');

  const { profileName, json } = parsed;

  if (profileName) {
    return showProfileDetail(profileName, ctx, !!json);
  }
  return _showList(ctx, !!json);
}

// ── List view ─────────────────────────────────────────────────────────────────

function _showList(ctx: CodexCommandContext, json: boolean): void {
  const { registry } = ctx;
  const names = registry.listProfiles();
  const defaultName = registry.getDefault();
  const activeName = process.env.CCS_CODEX_PROFILE ?? null;

  // D14: check if CCS_CODEX_PROFILE points to a deleted/missing profile
  const activeMissing =
    activeName !== null && activeName.length > 0 && !registry.hasProfile(activeName);

  interface Row {
    name: string;
    email: string;
    plan: string;
    lastUsed: string;
    state: string;
    missing?: boolean;
  }

  const rows: Row[] = [];

  // D14: active(missing) row at top
  if (activeMissing) {
    rows.push({
      name: activeName ?? '',
      email: '<unknown>',
      plan: '-',
      lastUsed: 'never',
      state: 'active(missing)',
      missing: true,
    });
  }

  for (const name of names) {
    const meta = registry.getProfile(name);
    const states: string[] = [];
    if (name === defaultName) states.push('default');
    if (name === activeName) states.push('active');

    const profileDir = resolveCodexProfileDir(name);
    const authJsonPath = path.join(profileDir, 'auth.json');
    let email = meta.email ?? '<unknown>';
    if (fs.existsSync(authJsonPath) && !meta.email) {
      const identity = decodeAccountIdentity(authJsonPath);
      email = identity.email ?? '<unknown>';
    }

    const lastUsed = meta.last_used ? formatRelativeTime(new Date(meta.last_used)) : 'never';

    rows.push({ name, email, plan: meta.plan_type ?? '-', lastUsed, state: states.join(',') });
  }

  if (json) {
    const profiles: CodexProfileOutput[] = rows.map((r) => {
      const meta = r.missing ? null : registry.getProfile(r.name);
      const profileDir = r.missing ? '' : resolveCodexProfileDir(r.name);
      return {
        name: r.name,
        is_default: r.name === defaultName,
        is_active: r.name === activeName,
        created: meta?.created ?? '',
        last_used: meta?.last_used ?? null,
        email: r.email === '<unknown>' ? null : r.email,
        plan: r.plan === '-' ? null : r.plan,
        account_id: null,
        profile_dir: profileDir,
        auth_json_exists: r.missing ? false : fs.existsSync(path.join(profileDir, 'auth.json')),
        auth_json_mtime: null,
        config_toml_link_target: null,
      };
    });
    console.log(JSON.stringify({ profiles }, null, 2));
    return;
  }

  if (names.length === 0 && !activeMissing) {
    console.log(info('No Codex profiles yet.'));
    console.log('    Create one: ccsx auth create <name>');
    return;
  }

  const count = names.length + (activeMissing ? 1 : 0);
  console.log(`Codex Profiles (${count})`);
  console.log('');

  const header = ['NAME', 'EMAIL', 'PLAN', 'LAST_USED', 'STATE'];
  const tableRows = [header, ...rows.map((r) => [r.name, r.email, r.plan, r.lastUsed, r.state])];
  console.log(table(tableRows, { colWidths: [14, 26, 8, 14, 18] }));
  console.log('');
  console.log(info('Default persists across shells. Active is current shell only.'));
}
