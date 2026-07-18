import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleApiCreateCommand } from '../../../src/commands/api-command/create-command';

describe('api create grandfathered force policy', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;
  let originalUnifiedMode: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-api-create-grandfathered-'));
    originalCcsHome = process.env.CCS_HOME;
    originalUnifiedMode = process.env.CCS_UNIFIED_CONFIG;
    process.env.CCS_HOME = tempHome;
    delete process.env.CCS_UNIFIED_CONFIG;
  });

  afterEach(() => {
    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }
    if (originalUnifiedMode === undefined) {
      delete process.env.CCS_UNIFIED_CONFIG;
    } else {
      process.env.CCS_UNIFIED_CONFIG = originalUnifiedMode;
    }
    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('allows ccs api create --force to repair an exact existing xai profile', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { xai: '~/.ccs/xai.settings.json' } }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'xai.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://old.example.com', ANTHROPIC_AUTH_TOKEN: 'old' } },
        null,
        2
      ) + '\n'
    );
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      await handleApiCreateCommand([
        'xai',
        '--force',
        '--yes',
        '--base-url',
        'https://new.example.com',
        '--api-key',
        'new-token',
        '--model',
        'new-model',
      ]);
    } finally {
      logSpy.mockRestore();
    }

    const settings = JSON.parse(
      fs.readFileSync(path.join(ccsDir, 'xai.settings.json'), 'utf8')
    ) as {
      env: Record<string, string>;
    };
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://new.example.com');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('new-token');
  });

  it('rejects ccs api create --force when the reserved profile is absent', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: {} }, null, 2) + '\n'
    );

    const originalExit = process.exit;
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit;

    try {
      await expect(
        handleApiCreateCommand([
          'grok',
          '--force',
          '--yes',
          '--base-url',
          'https://new.example.com',
          '--api-key',
          'new-token',
          '--model',
          'new-model',
        ])
      ).rejects.toThrow('process.exit(1)');
    } finally {
      process.exit = originalExit;
      logSpy.mockRestore();
    }

    expect(fs.existsSync(path.join(ccsDir, 'grok.settings.json'))).toBe(false);
  });
});
