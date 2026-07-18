import { ConfigError } from '../errors/error-types';

/**
 * Reserved profile names that cannot be used for user-defined profiles.
 * These names are reserved for CLIProxy providers and CLI commands.
 */
export const RESERVED_PROFILE_NAMES = [
  // CLIProxy providers (built-in OAuth)
  'gemini',
  'codex',
  'xai',
  'grok',
  'agy',
  'qwen',
  'iflow',
  'kiro',
  'ghcp',
  'claude',
  'kimi',
  'gitlab',
  'codebuddy',
  'kilo',
  'qoder',
  // Copilot API (GitHub Copilot proxy)
  'copilot',
  // Cursor IDE (Cursor proxy daemon)
  'cursor',
  'legacy-cursor',
  'legacy',
  // CLI commands and special names
  'default',
  'config',
  'cliproxy',
  'proxy',
] as const;

export type ReservedProfileName = (typeof RESERVED_PROFILE_NAMES)[number];

/**
 * Reserved names that may still identify profiles created before the
 * corresponding built-in provider shortcuts shipped.
 */
export const GRANDFATHERED_RESERVED_PROFILE_NAMES = ['xai', 'grok'] as const;
export type GrandfatheredReservedProfileName =
  (typeof GRANDFATHERED_RESERVED_PROFILE_NAMES)[number];

/**
 * Windows reserved device names - cannot be used as filenames on Windows.
 * Case-insensitive on Windows filesystem.
 */
export const WINDOWS_RESERVED_NAMES = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
] as const;

/**
 * Check if a name is reserved and cannot be used for user profiles.
 * @param name - The profile name to check
 * @returns true if the name is reserved
 */
export function isReservedName(name: string): boolean {
  return RESERVED_PROFILE_NAMES.includes(name.toLowerCase() as ReservedProfileName);
}

/**
 * Check whether a reserved name may identify an existing grandfathered profile.
 * This does not permit creating a new profile with the name.
 */
export function isGrandfatheredReservedProfileName(name: string): boolean {
  return GRANDFATHERED_RESERVED_PROFILE_NAMES.includes(
    name.toLowerCase() as GrandfatheredReservedProfileName
  );
}

/**
 * Allow a reserved grandfathered name only for an explicit overwrite of the
 * exact profile that already owns it.
 */
export function canOverwriteGrandfatheredReservedProfileName(
  name: string,
  options: { force: boolean; exists: boolean }
): boolean {
  return options.force && options.exists && isGrandfatheredReservedProfileName(name);
}

/**
 * Check if a name is a Windows reserved device name.
 * These cause filesystem errors on Windows systems.
 * @param name - The name to check
 * @returns true if the name is a Windows reserved name
 */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED_NAMES.includes(
    name.toUpperCase() as (typeof WINDOWS_RESERVED_NAMES)[number]
  );
}

/**
 * Validate a profile name and throw if reserved.
 * @param name - The profile name to validate
 * @throws Error if the name is reserved
 */
export function validateProfileName(name: string): void {
  if (isReservedName(name)) {
    throw new ConfigError(
      `Profile name '${name}' is reserved. Reserved names: ${RESERVED_PROFILE_NAMES.join(', ')}`
    );
  }
}
