import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  normalizePluginMetadataContent,
  normalizePluginMetadataPathString,
} from '../../src/management/plugin-path-normalizer';
import SharedManager, {
  normalizePluginMetadataContent as normalizeSharedManagerPluginMetadataContent,
  normalizePluginMetadataPathString as normalizeSharedManagerPluginMetadataPathString,
} from '../../src/management/shared-manager';

describe('SharedManager', () => {
  let tempRoot = '';
  let originalHome: string | undefined;
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;
  let originalPlatform: PropertyDescriptor | undefined;

  const claudeDir = () => path.join(tempRoot, '.claude');
  const ccsDir = () => path.join(tempRoot, '.ccs');
  const instanceDir = (name: string) => path.join(ccsDir(), 'instances', name);
  const marketplacePath = (configDir: string, name = 'claude-code-plugins') =>
    path.join(configDir, 'plugins', 'marketplaces', name);
  const readJson = (filePath: string) =>
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

  function ensureMarketplacePayload(configDir: string, name = 'claude-code-plugins'): void {
    fs.mkdirSync(marketplacePath(configDir, name), { recursive: true });
  }

  function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  function readMarketplaceLocation(filePath: string, name = 'claude-code-plugins'): string {
    const parsed = readJson(filePath) as Record<string, { installLocation?: string }>;
    return parsed[name]?.installLocation ?? '';
  }

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shared-manager-test-'));
    originalHome = process.env.HOME;
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

    spyOn(os, 'homedir').mockReturnValue(tempRoot);
    process.env.HOME = tempRoot;
    process.env.CCS_HOME = tempRoot;
    delete process.env.CCS_DIR;
  });

  afterEach(() => {
    mock.restore();

    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;

    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;

    if (originalCcsDir !== undefined) process.env.CCS_DIR = originalCcsDir;
    else delete process.env.CCS_DIR;

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('plugin metadata path normalization', () => {
    it('rewrites instance plugin paths to the requested target config dir', () => {
      const targetConfigDir = path.join('/home/user', '.claude');
      const input = '/home/user/.ccs/instances/work/plugins/cache/plugin/0.0.2';

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(
        '/home/user/.claude/plugins/cache/plugin/0.0.2'
      );
    });

    it('rewrites shared plugin paths to an instance-local target config dir', () => {
      const targetConfigDir = instanceDir('personal');
      const input = path.join(tempRoot, '.ccs', 'shared', 'plugins', 'marketplaces', 'official');

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(
        marketplacePath(targetConfigDir, 'official')
      );
    });

    it('normalizes all matching JSON string values without changing the structure', () => {
      const targetConfigDir = instanceDir('work');
      const input = JSON.stringify(
        {
          plugins: {
            'plugin-a': [
              {
                installPath: path.join(
                  tempRoot,
                  '.ccs',
                  'instances',
                  'old',
                  'plugins',
                  'cache',
                  'plugin-a'
                ),
              },
            ],
          },
          marketplaces: {
            official: {
              installLocation: path.join(
                tempRoot,
                '.claude',
                'plugins',
                'marketplaces',
                'official'
              ),
            },
          },
        },
        null,
        2
      );

      const normalized = JSON.parse(normalizePluginMetadataContent(input, targetConfigDir)) as {
        plugins: { 'plugin-a': [{ installPath: string }] };
        marketplaces: { official: { installLocation: string } };
      };

      expect(normalized.plugins['plugin-a'][0].installPath).toBe(
        path.join(targetConfigDir, 'plugins', 'cache', 'plugin-a')
      );
      expect(normalized.marketplaces.official.installLocation).toBe(
        marketplacePath(targetConfigDir, 'official')
      );
    });

    it('preserves paths already rooted at the target config dir', () => {
      const targetConfigDir = instanceDir('work');
      const input = path.join(targetConfigDir, 'plugins', 'cache', 'plugin-a');

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(input);
    });

    it('preserves original JSON content when no plugin path changes are needed', () => {
      const original = JSON.stringify({ plugins: { 'plugin-a': { enabled: true } } }, null, 4);

      expect(normalizePluginMetadataContent(original, instanceDir('work'))).toBe(original);
    });

    it('handles Windows path separators', () => {
      const targetConfigDir = 'C:\\Users\\user\\.claude';
      const input = 'C:\\Users\\user\\.ccs\\instances\\work\\plugins\\marketplaces\\official';

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(
        'C:\\Users\\user\\.claude\\plugins\\marketplaces\\official'
      );
    });

    it('uses the current home directory when target config dir is omitted', () => {
      const input = path.join(tempRoot, '.ccs', 'shared', 'plugins', 'cache', 'plugin-a');

      expect(normalizePluginMetadataPathString(input)).toBe(
        path.join(tempRoot, '.claude', 'plugins', 'cache', 'plugin-a')
      );
    });

    it('keeps the legacy shared-manager helper export compatible', () => {
      const targetConfigDir = instanceDir('work');
      const input = path.join(tempRoot, '.ccs', 'shared', 'plugins', 'cache', 'plugin-a');
      const content = JSON.stringify({ installPath: input }, null, 2);

      expect(normalizeSharedManagerPluginMetadataPathString(input, targetConfigDir)).toBe(
        normalizePluginMetadataPathString(input, targetConfigDir)
      );
      expect(normalizeSharedManagerPluginMetadataContent(content, targetConfigDir)).toBe(
        normalizePluginMetadataContent(content, targetConfigDir)
      );
    });
  });

  describe('shared symlink lifecycle', () => {
    it('does not rewrite inverse shared symlink chains into a real loop', () => {
      const manager = new SharedManager();
      const externalCommandsDir = path.join(tempRoot, 'Documents', 'claude-config', 'commands');
      const claudeCommandsPath = path.join(claudeDir(), 'commands');
      const sharedCommandsPath = path.join(ccsDir(), 'shared', 'commands');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});

      fs.mkdirSync(externalCommandsDir, { recursive: true });
      fs.mkdirSync(claudeDir(), { recursive: true });
      fs.mkdirSync(path.join(ccsDir(), 'shared'), { recursive: true });
      fs.symlinkSync(sharedCommandsPath, claudeCommandsPath, 'dir');
      fs.symlinkSync(externalCommandsDir, sharedCommandsPath, 'dir');

      manager.ensureSharedDirectories();

      expect(
        logSpy.mock.calls.some(([message]) =>
          String(message).includes('Skipping commands: circular symlink detected')
        )
      ).toBe(true);
      expect(fs.lstatSync(claudeCommandsPath).isSymbolicLink()).toBe(true);
      expect(
        path.resolve(path.dirname(claudeCommandsPath), fs.readlinkSync(claudeCommandsPath))
      ).toBe(sharedCommandsPath);
      expect(fs.lstatSync(sharedCommandsPath).isSymbolicLink()).toBe(true);
      expect(
        path.resolve(path.dirname(sharedCommandsPath), fs.readlinkSync(sharedCommandsPath))
      ).toBe(externalCommandsDir);
    });

    it('preserves external ~/.claude symlinks during upgrade reconciliation', () => {
      const manager = new SharedManager();
      const externalCommandsDir = path.join(tempRoot, 'Documents', 'claude-config', 'commands');
      const externalSettingsPath = path.join(
        tempRoot,
        'Documents',
        'claude-config',
        'settings.json'
      );
      const claudeCommandsPath = path.join(claudeDir(), 'commands');
      const claudeSettingsPath = path.join(claudeDir(), 'settings.json');
      const sharedCommandsPath = path.join(ccsDir(), 'shared', 'commands');
      const sharedSettingsPath = path.join(ccsDir(), 'shared', 'settings.json');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});

      fs.mkdirSync(externalCommandsDir, { recursive: true });
      fs.mkdirSync(path.dirname(externalSettingsPath), { recursive: true });
      fs.mkdirSync(claudeDir(), { recursive: true });
      fs.mkdirSync(path.join(ccsDir(), 'shared'), { recursive: true });
      fs.writeFileSync(externalSettingsPath, JSON.stringify({ theme: 'dark' }), 'utf8');
      fs.symlinkSync(externalCommandsDir, claudeCommandsPath, 'dir');
      fs.symlinkSync(externalSettingsPath, claudeSettingsPath, 'file');
      fs.symlinkSync(claudeCommandsPath, sharedCommandsPath, 'dir');
      fs.symlinkSync(claudeSettingsPath, sharedSettingsPath, 'file');

      manager.ensureSharedDirectories();

      expect(
        logSpy.mock.calls.some(
          ([message]) =>
            String(message).includes('Skipping commands: circular symlink detected') ||
            String(message).includes('Skipping settings.json: circular symlink detected')
        )
      ).toBe(false);
      expect(fs.lstatSync(sharedCommandsPath).isSymbolicLink()).toBe(true);
      expect(
        path.resolve(path.dirname(sharedCommandsPath), fs.readlinkSync(sharedCommandsPath))
      ).toBe(claudeCommandsPath);
      expect(fs.lstatSync(sharedSettingsPath).isSymbolicLink()).toBe(true);
      expect(
        path.resolve(path.dirname(sharedSettingsPath), fs.readlinkSync(sharedSettingsPath))
      ).toBe(claudeSettingsPath);
    });

    it('still blocks real circular links back into ~/.ccs/shared', () => {
      const manager = new SharedManager();
      const claudeCommandsPath = path.join(claudeDir(), 'commands');
      const sharedCommandsPath = path.join(ccsDir(), 'shared', 'commands');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});

      fs.mkdirSync(claudeDir(), { recursive: true });
      fs.mkdirSync(sharedCommandsPath, { recursive: true });
      fs.symlinkSync(sharedCommandsPath, claudeCommandsPath, 'dir');

      manager.ensureSharedDirectories();

      expect(
        logSpy.mock.calls.some(([message]) =>
          String(message).includes('Skipping commands: circular symlink detected')
        )
      ).toBe(true);
      expect(fs.lstatSync(sharedCommandsPath).isDirectory()).toBe(true);
    });

    it('does not materialize dangling external settings symlinks', () => {
      const manager = new SharedManager();
      const externalSettingsPath = path.join(
        tempRoot,
        'Documents',
        'claude-config',
        'settings.json'
      );
      const claudeSettingsPath = path.join(claudeDir(), 'settings.json');
      const sharedSettingsPath = path.join(ccsDir(), 'shared', 'settings.json');

      fs.mkdirSync(path.dirname(externalSettingsPath), { recursive: true });
      fs.mkdirSync(claudeDir(), { recursive: true });
      fs.symlinkSync(externalSettingsPath, claudeSettingsPath, 'file');

      manager.ensureSharedDirectories();

      expect(fs.lstatSync(claudeSettingsPath).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(externalSettingsPath)).toBe(false);
      expect(fs.lstatSync(sharedSettingsPath).isSymbolicLink()).toBe(true);
      expect(
        path.resolve(path.dirname(sharedSettingsPath), fs.readlinkSync(sharedSettingsPath))
      ).toBe(claudeSettingsPath);
    });
  });

  describe('marketplace registry ownership', () => {
    it('skips unstatable shared plugin entries during instance linking', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      const sharedPluginsPath = path.join(claudeDir(), 'plugins');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});

      fs.mkdirSync(instancePath, { recursive: true });
      fs.mkdirSync(sharedPluginsPath, { recursive: true });
      fs.symlinkSync(
        path.join(sharedPluginsPath, 'missing-plugin'),
        path.join(sharedPluginsPath, 'broken-plugin'),
        'dir'
      );

      expect(() => manager.linkSharedDirectories(instancePath)).not.toThrow();
      expect(fs.existsSync(path.join(instancePath, 'plugins', 'broken-plugin'))).toBe(false);
      expect(
        logSpy.mock.calls.some(([message]) =>
          String(message).includes(
            'Skipping plugins/broken-plugin: unable to inspect shared plugin entry'
          )
        )
      ).toBe(true);
    });

    it('writes global and instance registries with different authoritative install locations', () => {
      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      ensureMarketplacePayload(claudeDir());
      writeJson(globalRegistryPath, {
        'claude-code-plugins': {
          installLocation: path.join(
            tempRoot,
            '.ccs',
            'instances',
            'work',
            'plugins',
            'marketplaces',
            'claude-code-plugins'
          ),
        },
      });

      const instancePath = instanceDir('personal');
      fs.mkdirSync(instancePath, { recursive: true });

      const manager = new SharedManager();
      manager.linkSharedDirectories(instancePath);

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      expect(readMarketplaceLocation(globalRegistryPath)).toBe(marketplacePath(claudeDir()));
      expect(readMarketplaceLocation(instanceRegistryPath)).toBe(marketplacePath(instancePath));
      expect(fs.lstatSync(path.join(instancePath, 'plugins')).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(instanceRegistryPath).isSymbolicLink()).toBe(false);
    });

    it('self-heals missing installLocation from discovered marketplace payloads', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      fs.mkdirSync(marketplacePath(claudeDir()), { recursive: true });
      writeJson(path.join(instancePath, 'plugins', 'known_marketplaces.json'), {
        'claude-code-plugins': {
          label: 'Official marketplace',
        },
      });

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      const repaired = readJson(
        path.join(instancePath, 'plugins', 'known_marketplaces.json')
      ) as Record<string, { label?: string; installLocation?: string }>;
      expect(repaired['claude-code-plugins']).toEqual({
        label: 'Official marketplace',
        installLocation: marketplacePath(instancePath),
      });
    });

    it('prunes stale marketplace entries whose payload directories no longer exist', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      fs.mkdirSync(marketplacePath(claudeDir(), 'claude-code-plugins'), { recursive: true });
      writeJson(path.join(instancePath, 'plugins', 'known_marketplaces.json'), {
        'claude-code-plugins': {
          installLocation: marketplacePath(instancePath, 'claude-code-plugins'),
          label: 'Official marketplace',
        },
        stale: {
          installLocation: marketplacePath(instancePath, 'stale'),
          label: 'Stale marketplace',
        },
      });

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      const reconciled = readJson(
        path.join(instancePath, 'plugins', 'known_marketplaces.json')
      ) as Record<string, { label?: string; installLocation?: string }>;
      expect(reconciled['claude-code-plugins']).toEqual({
        installLocation: marketplacePath(instancePath, 'claude-code-plugins'),
        label: 'Official marketplace',
      });
      expect(reconciled.stale).toBeUndefined();
    });

    it('does not register transient marketplace directories left behind by interrupted auto-updates', () => {
      // Regression: CCS used to write bare { installLocation } entries for marketplace
      // directories with no registry record. Claude Code requires source + lastUpdated,
      // so those entries corrupted known_marketplaces.json and broke /plugin.
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      // Simulate Claude Code leaving rename-dance temp dirs behind in both the
      // global claude dir and the instance dir (discoverMarketplaceEntries scans
      // each independently).
      for (const suffix of ['.staging', '.bak']) {
        fs.mkdirSync(marketplacePath(claudeDir(), `claude-plugins-official${suffix}`), {
          recursive: true,
        });
        fs.mkdirSync(marketplacePath(instancePath, `claude-plugins-official${suffix}`), {
          recursive: true,
        });
      }

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      const global = readJson(globalRegistryPath) as Record<string, unknown>;
      expect(global['claude-plugins-official.staging']).toBeUndefined();
      expect(global['claude-plugins-official.bak']).toBeUndefined();

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      const instance = readJson(instanceRegistryPath) as Record<string, unknown>;
      expect(instance['claude-plugins-official.staging']).toBeUndefined();
      expect(instance['claude-plugins-official.bak']).toBeUndefined();
    });

    it('removes registry entries whose physical marketplace directory no longer exists', () => {
      // Regression guard: buildMarketplaceRegistryContent merges JSON sources then
      // cross-checks against discoveredEntries. Any name in the merged registry that
      // has no matching directory on disk must be pruned so stale entries don't
      // accumulate across marketplace uninstalls or renames.
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      // Write a registry entry for a marketplace that has no physical directory.
      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      writeJson(globalRegistryPath, {
        'vanished-marketplace': {
          source: { type: 'github', repo: 'example/vanished' },
          lastUpdated: '2024-01-01T00:00:00.000Z',
          installLocation: marketplacePath(claudeDir(), 'vanished-marketplace'),
        },
      });
      // Intentionally do NOT create the physical directory — simulate an uninstalled
      // marketplace whose registry entry was not cleaned up.

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      const global = readJson(globalRegistryPath) as Record<string, unknown>;
      expect(global['vanished-marketplace']).toBeUndefined();

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      const instance = readJson(instanceRegistryPath) as Record<string, unknown>;
      expect(instance['vanished-marketplace']).toBeUndefined();
    });

    it('drops malformed marketplace entries even when the payload directory still exists', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      fs.mkdirSync(marketplacePath(claudeDir(), 'claude-code-plugins'), { recursive: true });

      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      writeJson(globalRegistryPath, {
        'claude-code-plugins': 'bad-entry',
      });

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      const global = readJson(globalRegistryPath) as Record<string, unknown>;
      expect(global['claude-code-plugins']).toBeUndefined();

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      const instance = readJson(instanceRegistryPath) as Record<string, unknown>;
      expect(instance['claude-code-plugins']).toBeUndefined();
    });

    it('warns and skips malformed marketplace registries while keeping valid sources', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      ensureMarketplacePayload(claudeDir());
      writeJson(globalRegistryPath, {
        'claude-code-plugins': {
          installLocation: path.join(
            tempRoot,
            '.ccs',
            'instances',
            'work',
            'plugins',
            'marketplaces',
            'claude-code-plugins'
          ),
          label: 'Official marketplace',
        },
      });

      const malformedRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      fs.writeFileSync(malformedRegistryPath, '{invalid-json', 'utf8');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      expect(readMarketplaceLocation(malformedRegistryPath)).toBe(marketplacePath(instancePath));
      expect(
        logSpy.mock.calls.some(
          ([message]) =>
            String(message).includes('Skipping malformed marketplace registry') &&
            String(message).includes(malformedRegistryPath)
        )
      ).toBe(true);
    });

    it('keeps the instance-local registry valid under Windows copy fallback', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      spyOn(fs, 'symlinkSync').mockImplementation(() => {
        throw Object.assign(new Error('simulated symlink failure'), { code: 'EPERM' });
      });

      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      ensureMarketplacePayload(claudeDir());
      writeJson(globalRegistryPath, {
        'claude-code-plugins': {
          installLocation: path.join(
            tempRoot,
            '.claude',
            'plugins',
            'marketplaces',
            'claude-code-plugins'
          ),
        },
      });

      const instancePath = instanceDir('personal');
      fs.mkdirSync(instancePath, { recursive: true });

      const manager = new SharedManager();
      manager.linkSharedDirectories(instancePath);

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      expect(readMarketplaceLocation(globalRegistryPath)).toBe(marketplacePath(claudeDir()));
      expect(readMarketplaceLocation(instanceRegistryPath)).toBe(marketplacePath(instancePath));
      expect(fs.existsSync(path.join(instancePath, 'plugins', 'marketplaces'))).toBe(true);
    });
  });
});
