import { describe, expect, it } from 'bun:test';
import { detectShell, formatExport } from '../../../src/codex-auth/shell-detect';
import type { Shell } from '../../../src/codex-auth/shell-detect';

// ── detectShell ───────────────────────────────────────────────────────────────

describe('detectShell — Unix', () => {
  it('returns bash for /bin/bash', () => {
    expect(detectShell({ SHELL: '/bin/bash' }, 'linux')).toBe('bash');
  });

  it('returns zsh for /usr/bin/zsh', () => {
    expect(detectShell({ SHELL: '/usr/bin/zsh' }, 'darwin')).toBe('zsh');
  });

  it('returns fish for /usr/local/bin/fish', () => {
    expect(detectShell({ SHELL: '/usr/local/bin/fish' }, 'linux')).toBe('fish');
  });

  it('returns bash for /bin/sh (generic POSIX)', () => {
    expect(detectShell({ SHELL: '/bin/sh' }, 'linux')).toBe('bash');
  });

  it('returns bash when SHELL is unset', () => {
    expect(detectShell({}, 'linux')).toBe('bash');
  });

  it('returns bash for /usr/local/bin/bash (Homebrew)', () => {
    expect(detectShell({ SHELL: '/usr/local/bin/bash' }, 'darwin')).toBe('bash');
  });
});

describe('detectShell — Windows', () => {
  it('returns pwsh when PSModulePath is set', () => {
    expect(detectShell({ PSModulePath: 'C:\\Windows\\system32\\...' }, 'win32')).toBe('pwsh');
  });

  it('returns cmd when PSModulePath is absent', () => {
    expect(detectShell({}, 'win32')).toBe('cmd');
  });

  it('ignores SHELL on Windows — uses PSModulePath heuristic', () => {
    expect(detectShell({ SHELL: '/bin/bash', PSModulePath: 'C:\\ps' }, 'win32')).toBe('pwsh');
  });
});

// ── formatExport ──────────────────────────────────────────────────────────────

describe('formatExport — bash', () => {
  it('wraps value in single quotes', () => {
    expect(formatExport('bash', 'CODEX_HOME', '/home/user/.ccs/codex-instances/work')).toBe(
      "export CODEX_HOME='/home/user/.ccs/codex-instances/work'"
    );
  });

  it('escapes single quotes in value', () => {
    const result = formatExport('bash', 'X', "it's");
    expect(result).toBe("export X='it'\\''s'");
  });
});

describe('formatExport — zsh', () => {
  it('uses same syntax as bash', () => {
    expect(formatExport('zsh', 'CCS_CODEX_PROFILE', 'work')).toBe(
      "export CCS_CODEX_PROFILE='work'"
    );
  });
});

describe('formatExport — fish', () => {
  it('uses set -gx syntax with semicolon', () => {
    expect(formatExport('fish', 'CODEX_HOME', '/path/to/dir')).toBe(
      "set -gx CODEX_HOME '/path/to/dir';"
    );
  });

  it('escapes single quotes', () => {
    const result = formatExport('fish', 'X', "a'b");
    expect(result).toContain('set -gx X');
    expect(result).toContain("'a'\\''b'");
  });
});

describe('formatExport — pwsh', () => {
  it('uses $env: assignment with double quotes', () => {
    expect(formatExport('pwsh', 'CODEX_HOME', 'C:\\Users\\foo')).toBe(
      '$env:CODEX_HOME = "C:\\Users\\foo"'
    );
  });

  it('doubles internal double quotes', () => {
    const result = formatExport('pwsh', 'X', 'say "hello"');
    expect(result).toBe('$env:X = "say ""hello"""');
  });
});

describe('formatExport — cmd', () => {
  it('uses set KEY=VALUE syntax without quotes', () => {
    expect(formatExport('cmd', 'CODEX_HOME', 'C:\\Users\\foo\\.ccs\\codex-instances\\work')).toBe(
      'set CODEX_HOME=C:\\Users\\foo\\.ccs\\codex-instances\\work'
    );
  });
});

describe('formatExport — each shell produces distinct syntax', () => {
  const shells: Shell[] = ['bash', 'zsh', 'fish', 'pwsh', 'cmd'];
  it('all shells produce different output for same input', () => {
    const outputs = shells.map((s) => formatExport(s, 'K', 'val'));
    const unique = new Set(outputs);
    // fish and bash differ; pwsh and cmd differ; bash and zsh are identical by design
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });
});
