/**
 * codex-auth create command.
 * Creates a new profile dir + shared config.toml symlink.
 * After creation, auto-spawns `codex login` with CODEX_HOME pinned (D11).
 * --force: re-link config.toml only, preserve auth.json (D9).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { createLogger } from '../../services/logging';
import { initUI, info, ok } from '../../utils/ui';
import { exitWithError } from '../../errors';
import { ExitCode } from '../../errors/exit-codes';
import { resolveCodexProfileDir, ensureSharedConfigSymlink } from '../index';
import { decodeAccountIdentity } from '../codex-account-identity';
import { detectCodexCli } from '../../targets/codex-detector';
import { parseArgs, rejectUnsupportedOptions, getProfileNameError } from './types';
import type { CodexCommandContext } from './types';

const logger = createLogger('codex-auth:cmd:create');

export async function handleCreateCodex(ctx: CodexCommandContext, args: string[]): Promise<void> {
  await initUI();
  const parsed = parseArgs(args);
  rejectUnsupportedOptions(parsed, 'ccsx auth create <name> [--force]');

  const { profileName, force } = parsed;

  if (!profileName) {
    console.log(`Usage: ccsx auth create <name> [--force]`);
    exitWithError('Profile name required', ExitCode.PROFILE_ERROR);
    return;
  }

  const nameError = getProfileNameError(profileName);
  if (nameError) {
    exitWithError(nameError, ExitCode.PROFILE_ERROR);
    return;
  }

  const { registry } = ctx;
  const profileDir = resolveCodexProfileDir(profileName);

  // Idempotent: profile already exists
  if (registry.hasProfile(profileName)) {
    if (force) {
      // --force: only re-link config.toml, preserve auth.json
      console.log(info(`Profile already exists: ${profileName} (re-linking config.toml)`));
      _ensureSymlinkSafe(profileDir);
      console.log(ok(`Profile config.toml re-linked.`));
      console.log(`  Profile dir: ${profileDir}`);
    } else {
      console.log(info(`Profile already exists: ${profileName}`));
      console.log(`  Profile dir: ${profileDir}`);
      console.log(`  Run: ccsx auth login ${profileName}`);
    }
    return;
  }

  // Create profile dir + symlink FIRST (filesystem is more failure-prone than registry write).
  // Avoids registry orphan if mkdir hits EACCES/ENOSPC.
  try {
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    _ensureSymlinkSafe(profileDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      exitWithError(msg, ExitCode.GENERAL_ERROR);
      return;
    }
    throw err;
  }

  // Now register in the profile registry
  try {
    registry.createProfile(profileName, {
      created: new Date().toISOString(),
      last_used: null,
      email: undefined,
      plan_type: undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('corrupt') || msg.includes('Failed to write')) {
      exitWithError(
        `Profile registry is corrupt. Backup and remove the file to re-init.\n  ${msg}`,
        ExitCode.GENERAL_ERROR
      );
      return;
    }
    throw err;
  }

  const authJsonPath = path.join(profileDir, 'auth.json');
  const authExists = fs.existsSync(authJsonPath);

  console.log(info(`Creating Codex profile: ${profileName}`));
  console.log('');
  console.log(`  Profile dir : ${profileDir}`);
  console.log(`  Auth state  : ${authExists ? 'authenticated' : 'not authenticated'}`);
  console.log('');
  console.log(ok('Profile created.'));

  // D11: auto-spawn codex login after creating the profile
  await _spawnLogin(profileName, profileDir, ctx);
}

function _ensureSymlinkSafe(profileDir: string): void {
  try {
    ensureSharedConfigSymlink(profileDir);
  } catch (err) {
    // Symlink creation failure — warn + continue (Windows fallback documented)
    process.stderr.write(
      `[!] Symlinks unavailable; using copy. config.toml edits won't propagate.\n`
    );
    logger.warn('codex-auth.create.symlink-failed', 'Symlink creation failed', {
      profileDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function _spawnLogin(
  profileName: string,
  profileDir: string,
  ctx: CodexCommandContext
): Promise<void> {
  const codexCli = detectCodexCli();
  if (!codexCli) {
    process.stderr.write(`[!] codex CLI not found — skipping auto-login.\n`);
    process.stderr.write(`    Install: npm i -g @openai/codex\n`);
    process.stderr.write(`    Then run: ccsx auth login ${profileName}\n`);
    return;
  }

  console.log('');
  console.log(`Next step: logging in to Codex...`);
  console.log(`  CODEX_HOME=${profileDir}`);
  console.log('');

  await new Promise<void>((resolve) => {
    const child = childProcess.spawn(codexCli, ['login'], {
      stdio: 'inherit',
      env: { ...process.env, CODEX_HOME: profileDir },
      windowsHide: true,
    });

    child.on('error', (err) => {
      process.stderr.write(`[X] Failed to execute codex: ${err.message}\n`);
      resolve();
    });

    child.on('exit', (code) => {
      const authJsonPath = path.join(profileDir, 'auth.json');
      if (code === 0 && fs.existsSync(authJsonPath)) {
        const identity = decodeAccountIdentity(authJsonPath);
        if (identity.email || identity.plan_type) {
          ctx.registry.updateProfile(profileName, {
            last_used: new Date().toISOString(),
            email: identity.email,
            plan_type: identity.plan_type ?? null,
            account_id: identity.account_id,
          });
        }
        const emailStr = identity.email ? ` as ${identity.email}` : '';
        const planStr = identity.plan_type ? ` (plan: ${identity.plan_type})` : '';
        console.log(ok(`Logged in${emailStr}${planStr}`));
      } else if (code === 0) {
        process.stderr.write(
          `[!] codex login exited cleanly but no auth.json. Skipping registry update.\n`
        );
      } else {
        process.stderr.write(
          `[!] Login cancelled or failed. Profile ${profileName} remains unauthenticated.\n`
        );
        process.stderr.write(`    Retry: ccsx auth login ${profileName}\n`);
      }
      resolve();
    });
  });
}
