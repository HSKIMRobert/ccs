/**
 * WebSearch Hook Installer
 *
 * Manages installation and uninstallation of the legacy WebSearch hook runtime.
 *
 * @module utils/websearch/hook-installer
 */

import * as fs from 'fs';
import * as path from 'path';
import { info, warn } from '../ui';

import { getCcsDir, getCcsHooksDir } from '../config-manager';
import { getHookPath } from './hook-config';
import { getWebSearchConfig } from '../../config/config-loader-facade';
import type { WebSearchConfigSnapshot } from './launch-state';

// Re-export from hook-config for backward compatibility
export { getHookPath, getWebSearchHookConfig } from './hook-config';

// Hook file name
const WEBSEARCH_HOOK = 'websearch-transformer.cjs';

function hasMatchingHookContents(sourcePath: string, destinationPath: string): boolean {
  if (!fs.existsSync(destinationPath)) {
    return false;
  }

  const source = fs.readFileSync(sourcePath);
  try {
    const destination = fs.readFileSync(destinationPath);
    return source.equals(destination);
  } catch (error) {
    if (process.env.CCS_DEBUG) {
      console.error(
        warn(`Existing WebSearch hook is unreadable; reinstalling: ${(error as Error).message}`)
      );
    }
    return false;
  }
}

function getTempHookPath(hookPath: string): string {
  const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${hookPath}.${uniqueSuffix}.tmp`;
}

export function getMigrationMarkerPath(): string {
  return path.join(getCcsDir(), '.hook-migrated');
}

export function removeMigrationMarker(): void {
  try {
    const markerPath = getMigrationMarkerPath();
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }
  } catch (error) {
    if (process.env.CCS_DEBUG) {
      console.error(warn(`removeMigrationMarker failed: ${(error as Error).message}`));
    }
  }
}

/**
 * Check if WebSearch hook is installed
 */
export function hasWebSearchHook(): boolean {
  return fs.existsSync(getHookPath());
}

/**
 * Install WebSearch hook to ~/.ccs/hooks/
 *
 * This hook now serves as a compatibility fallback and a shared provider runtime
 * for the first-class CCS WebSearch MCP server.
 *
 * @returns true if hook installed successfully
 */
export function installWebSearchHook(
  wsConfig: WebSearchConfigSnapshot = getWebSearchConfig()
): boolean {
  try {
    // Skip if disabled
    if (!wsConfig.enabled) {
      if (process.env.CCS_DEBUG) {
        console.error(info('WebSearch disabled - skipping hook install'));
      }
      return false;
    }

    // Ensure hooks directory exists
    const hooksDir = getCcsHooksDir();
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
    }

    const hookPath = getHookPath();

    // Find the bundled hook script
    // In npm package: node_modules/ccs/lib/hooks/
    // In development: lib/hooks/
    const possiblePaths = [
      path.join(__dirname, '..', '..', '..', 'lib', 'hooks', WEBSEARCH_HOOK),
      path.join(__dirname, '..', '..', 'lib', 'hooks', WEBSEARCH_HOOK),
      path.join(__dirname, '..', 'lib', 'hooks', WEBSEARCH_HOOK),
    ];

    let sourcePath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        sourcePath = p;
        break;
      }
    }

    if (!sourcePath) {
      if (process.env.CCS_DEBUG) {
        console.error(warn(`WebSearch hook source not found: ${WEBSEARCH_HOOK}`));
      }
      return false;
    }

    // Avoid rewriting the shared hook binary when the bundled script is unchanged.
    if (hasMatchingHookContents(sourcePath, hookPath)) {
      return true;
    }

    // Copy hook to ~/.ccs/hooks/ via a unique temp path so concurrent installers
    // do not contend on the same file.
    const tempHookPath = getTempHookPath(hookPath);
    try {
      fs.copyFileSync(sourcePath, tempHookPath);
      fs.chmodSync(tempHookPath, 0o755);

      try {
        fs.renameSync(tempHookPath, hookPath);
      } catch (renameError) {
        const errorCode = (renameError as NodeJS.ErrnoException).code;
        if (errorCode !== 'EEXIST' && errorCode !== 'EPERM') {
          throw renameError;
        }

        fs.copyFileSync(tempHookPath, hookPath);
        fs.chmodSync(hookPath, 0o755);
        fs.unlinkSync(tempHookPath);
      }
    } finally {
      if (fs.existsSync(tempHookPath)) {
        fs.unlinkSync(tempHookPath);
      }
    }

    if (process.env.CCS_DEBUG) {
      console.error(info(`Installed WebSearch hook: ${hookPath}`));
    }

    // Note: Hook registration is handled by ensureProfileHooks() in profile-hook-injector.ts
    // which writes to per-profile settings (~/.ccs/<profile>.settings.json)
    // Global settings (~/.claude/settings.json) are NOT modified here

    return true;
  } catch (error) {
    if (process.env.CCS_DEBUG) {
      console.error(warn(`Failed to install WebSearch hook: ${(error as Error).message}`));
    }
    return false;
  }
}

/**
 * Uninstall WebSearch hook from ~/.ccs/hooks/
 *
 * Note: Does NOT touch global ~/.claude/settings.json.
 * Profile-specific hooks are removed when ~/.ccs/ is deleted.
 *
 * @returns true if hook uninstalled successfully
 */
export function uninstallWebSearchHook(): boolean {
  try {
    const hookPath = getHookPath();

    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
      if (process.env.CCS_DEBUG) {
        console.error(info(`Uninstalled WebSearch hook: ${hookPath}`));
      }
    }

    // Remove migration marker (so fresh install re-runs migration)
    removeMigrationMarker();

    // Note: Do NOT call removeHookConfig() - global settings should not be touched.
    // Per-profile hooks in ~/.ccs/*.settings.json are cleaned up when ~/.ccs/ is deleted.

    return true;
  } catch (error) {
    if (process.env.CCS_DEBUG) {
      console.error(warn(`Failed to uninstall WebSearch hook: ${(error as Error).message}`));
    }
    return false;
  }
}
