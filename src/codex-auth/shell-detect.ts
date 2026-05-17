/**
 * Shell detection for codex-auth use command.
 * Determines current shell to emit correct eval-safe export syntax.
 */

export type Shell = 'bash' | 'zsh' | 'fish' | 'pwsh' | 'cmd';

/**
 * Detect current shell from environment.
 * On Windows: PSModulePath presence → pwsh, else cmd.
 * On Unix: inspect $SHELL suffix.
 */
export function detectShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform
): Shell {
  if (platform === 'win32') {
    return env.PSModulePath ? 'pwsh' : 'cmd';
  }
  const sh = (env.SHELL ?? '').toLowerCase();
  if (sh.endsWith('/fish')) return 'fish';
  if (sh.endsWith('/zsh')) return 'zsh';
  return 'bash'; // default for bash, sh, dash, ksh
}

/**
 * Single-quote escape for POSIX shells (bash/zsh/fish).
 * Closes the single-quote, inserts escaped quote, reopens.
 */
function posixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Double-quote escape for PowerShell.
 * Wraps in double quotes; escapes internal double quotes by doubling them
 * and backtick-escapes $ to prevent variable interpolation.
 */
function pwshDoubleQuote(value: string): string {
  return '"' + value.replace(/"/g, '""').replace(/\$/g, '`$') + '"';
}

/**
 * Format a single env var export statement for the target shell.
 * Used by use-command to emit eval-safe lines.
 */
export function formatExport(shell: Shell, key: string, value: string): string {
  switch (shell) {
    case 'fish':
      return `set -gx ${key} ${posixSingleQuote(value)};`;
    case 'pwsh':
      return `$env:${key} = ${pwshDoubleQuote(value)}`;
    case 'cmd':
      // cmd.exe: no quoting — values are used verbatim.
      // NOTE: cmd.exe cannot eval output from a node process natively.
      // Users should prefer PowerShell. See --help for details.
      return `set ${key}=${value}`;
    default:
      // bash / zsh
      return `export ${key}=${posixSingleQuote(value)}`;
  }
}
