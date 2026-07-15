import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempDir: string;
let profileDir: string;
let sharedCodexHome: string;
const cachedSkillRelativePath = path.join(
  'openai-bundled',
  'sites',
  '0.1.27',
  'skills',
  'site-builder',
  'SKILL.md'
);
const staleCachedSkillRelativePath = path.join(
  'openai-bundled',
  'sites',
  '0.1.26',
  'skills',
  'site-builder',
  'SKILL.md'
);

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-resources-test-'));
  profileDir = path.join(tempDir, 'profile');
  sharedCodexHome = path.join(tempDir, 'shared-codex');
  fs.mkdirSync(path.join(sharedCodexHome, 'agents'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(sharedCodexHome, 'agents', 'brainstormer.toml'),
    'name = "brainstormer"\n'
  );
  fs.mkdirSync(path.join(sharedCodexHome, 'skills'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sharedCodexHome, 'skills', 'review.md'), '# Review\n');
  fs.mkdirSync(
    path.join(sharedCodexHome, 'plugins', 'cache', path.dirname(cachedSkillRelativePath)),
    {
      recursive: true,
      mode: 0o700,
    }
  );
  fs.writeFileSync(
    path.join(sharedCodexHome, 'plugins', 'cache', cachedSkillRelativePath),
    '# Current shared skill\n'
  );
});

afterEach(() => {
  mock.restore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('ensureCodexProfileResources', () => {
  it('exposes shared agents, skills, and plugin cache in a fresh Codex profile', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );

    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    for (const resourceName of ['agents', 'skills']) {
      const resourcePath = path.join(profileDir, resourceName);
      expect(fs.lstatSync(resourcePath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(resourcePath)).toBe(path.join(sharedCodexHome, resourceName));
    }

    const cachedSkillPath = path.join(profileDir, 'plugins', 'cache', cachedSkillRelativePath);
    expect(fs.readFileSync(cachedSkillPath, 'utf8')).toBe('# Current shared skill\n');
  });

  it('replaces a stale profile-local plugin cache while preserving plugin siblings', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const pluginsDir = path.join(profileDir, 'plugins');
    const cacheDir = path.join(pluginsDir, 'cache');
    const staleSkillPath = path.join(cacheDir, staleCachedSkillRelativePath);
    const currentSkillPath = path.join(cacheDir, cachedSkillRelativePath);
    const siblingPath = path.join(pluginsDir, 'marketplaces.json');
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staleSkillPath, '# Stale profile skill\n');
    fs.writeFileSync(siblingPath, '{"preserve":true}\n');

    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    expect(fs.lstatSync(cacheDir).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(staleSkillPath)).toBe(false);
    expect(fs.readFileSync(currentSkillPath, 'utf8')).toBe('# Current shared skill\n');
    expect(fs.readFileSync(siblingPath, 'utf8')).toBe('{"preserve":true}\n');
  });

  it('refuses a symlinked plugins parent without changing its external target', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const sharedPluginsDir = path.join(sharedCodexHome, 'plugins');
    const sharedSkillPath = path.join(sharedCodexHome, 'plugins', 'cache', cachedSkillRelativePath);
    const profilePluginsDir = path.join(profileDir, 'plugins');
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    fs.symlinkSync(sharedPluginsDir, profilePluginsDir, 'dir');

    expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
      'profile plugins path is not a local directory'
    );

    expect(fs.lstatSync(profilePluginsDir).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(sharedPluginsDir, 'cache')).isDirectory()).toBe(true);
    expect(fs.readFileSync(sharedSkillPath, 'utf8')).toBe('# Current shared skill\n');
  });

  it('refuses a profile root that resolves to the shared Codex home without changing its cache', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const sharedPluginsDir = path.join(sharedCodexHome, 'plugins');
    const sharedCacheDir = path.join(sharedPluginsDir, 'cache');
    const sharedMarkerPath = path.join(sharedCacheDir, 'shared-marker.txt');
    fs.writeFileSync(sharedMarkerPath, 'preserve shared cache\n');
    const cacheInodeBeforeRepair = fs.lstatSync(sharedCacheDir).ino;
    fs.symlinkSync(sharedCodexHome, profileDir, 'dir');

    expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
      'profile plugins directory resolves to the shared plugins directory'
    );

    expect(fs.lstatSync(profileDir).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(sharedCacheDir).isDirectory()).toBe(true);
    expect(fs.lstatSync(sharedCacheDir).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(sharedCacheDir).ino).toBe(cacheInodeBeforeRepair);
    expect(fs.readFileSync(sharedMarkerPath, 'utf8')).toBe('preserve shared cache\n');
    expect(
      fs.readdirSync(sharedPluginsDir).some((name) => name.startsWith('.cache.ccs-backup-'))
    ).toBe(false);
  });

  it('refuses a shared plugins directory that resolves to the profile plugins directory', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const profilePluginsDir = path.join(profileDir, 'plugins');
    const profileCacheDir = path.join(profilePluginsDir, 'cache');
    const profileMarkerPath = path.join(profileCacheDir, 'profile-marker.txt');
    const sharedPluginsDir = path.join(sharedCodexHome, 'plugins');
    fs.mkdirSync(profileCacheDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(profileMarkerPath, 'preserve profile cache\n');
    const cacheInodeBeforeRepair = fs.lstatSync(profileCacheDir).ino;
    fs.rmSync(sharedPluginsDir, { recursive: true, force: true });
    fs.symlinkSync(profilePluginsDir, sharedPluginsDir, 'dir');

    expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
      'profile plugins directory resolves to the shared plugins directory'
    );

    expect(fs.lstatSync(sharedPluginsDir).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(profileCacheDir).isDirectory()).toBe(true);
    expect(fs.lstatSync(profileCacheDir).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(profileCacheDir).ino).toBe(cacheInodeBeforeRepair);
    expect(fs.readFileSync(profileMarkerPath, 'utf8')).toBe('preserve profile cache\n');
    expect(
      fs.readdirSync(profilePluginsDir).some((name) => name.startsWith('.cache.ccs-backup-'))
    ).toBe(false);
  });

  it('keeps the plugin cache projection stable across repeated repairs', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );

    ensureCodexProfileResources(profileDir, { sharedCodexHome });
    const cacheDir = path.join(profileDir, 'plugins', 'cache');
    const firstTarget = fs.readlinkSync(cacheDir);
    const firstInode = fs.lstatSync(cacheDir).ino;

    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    expect(fs.readlinkSync(cacheDir)).toBe(firstTarget);
    expect(fs.lstatSync(cacheDir).ino).toBe(firstInode);
    expect(fs.readFileSync(path.join(cacheDir, cachedSkillRelativePath), 'utf8')).toBe(
      '# Current shared skill\n'
    );
  });

  it('keeps a concurrently-created correct cache link instead of restoring stale state', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const cacheDir = path.join(profileDir, 'plugins', 'cache');
    const staleSkillPath = path.join(cacheDir, staleCachedSkillRelativePath);
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staleSkillPath, '# Stale profile skill\n');

    const realSymlinkSync = fs.symlinkSync.bind(fs);
    let injectedConcurrentRepair = false;
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(
      (...args: Parameters<typeof fs.symlinkSync>) => {
        const [, pathToCreate] = args;
        if (
          !injectedConcurrentRepair &&
          path.resolve(String(pathToCreate)) === path.resolve(cacheDir)
        ) {
          injectedConcurrentRepair = true;
          ensureCodexProfileResources(profileDir, { sharedCodexHome });
        }
        return realSymlinkSync(...args);
      }
    );

    try {
      ensureCodexProfileResources(profileDir, { sharedCodexHome });
    } finally {
      symlinkSpy.mockRestore();
    }

    expect(fs.lstatSync(cacheDir).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(staleSkillPath)).toBe(false);
    expect(fs.readFileSync(path.join(cacheDir, cachedSkillRelativePath), 'utf8')).toBe(
      '# Current shared skill\n'
    );
    expect(
      fs.readdirSync(path.dirname(cacheDir)).some((name) => name.startsWith('.cache.ccs-backup-'))
    ).toBe(false);
  });

  it('recovers when another repair moves the stale cache before this repair can rename it', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const cacheDir = path.join(profileDir, 'plugins', 'cache');
    const staleSkillPath = path.join(cacheDir, staleCachedSkillRelativePath);
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staleSkillPath, '# Stale profile skill\n');

    const realRenameSync = fs.renameSync.bind(fs);
    let injectedRenameRace = false;
    const renameSpy = spyOn(fs, 'renameSync').mockImplementation(
      (...args: Parameters<typeof fs.renameSync>) => {
        const [oldPath] = args;
        if (!injectedRenameRace && path.resolve(String(oldPath)) === path.resolve(cacheDir)) {
          injectedRenameRace = true;
          fs.rmSync(cacheDir, { recursive: true, force: true });
          throw Object.assign(new Error('simulated concurrent move'), { code: 'ENOENT' });
        }
        return realRenameSync(...args);
      }
    );

    try {
      ensureCodexProfileResources(profileDir, { sharedCodexHome });
    } finally {
      renameSpy.mockRestore();
    }

    expect(fs.lstatSync(cacheDir).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(staleSkillPath)).toBe(false);
    expect(fs.readFileSync(path.join(cacheDir, cachedSkillRelativePath), 'utf8')).toBe(
      '# Current shared skill\n'
    );
  });

  it('does not delete a concurrent cache path when symlink creation loses an EEXIST race', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const pluginsDir = path.join(profileDir, 'plugins');
    const cacheDir = path.join(pluginsDir, 'cache');
    const staleSkillPath = path.join(cacheDir, staleCachedSkillRelativePath);
    const concurrentMarkerPath = path.join(cacheDir, 'concurrent-marker.txt');
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staleSkillPath, '# Stale profile skill\n');

    const realSymlinkSync = fs.symlinkSync.bind(fs);
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(
      (...args: Parameters<typeof fs.symlinkSync>) => {
        const [, pathToCreate] = args;
        if (path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(concurrentMarkerPath, 'preserve concurrent cache\n');
          throw Object.assign(new Error('simulated concurrent EEXIST'), { code: 'EEXIST' });
        }
        return realSymlinkSync(...args);
      }
    );

    try {
      expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
        'simulated concurrent EEXIST'
      );
    } finally {
      symlinkSpy.mockRestore();
    }

    expect(fs.readFileSync(concurrentMarkerPath, 'utf8')).toBe('preserve concurrent cache\n');
    const backupNames = fs
      .readdirSync(pluginsDir)
      .filter((name) => name.startsWith('.cache.ccs-backup-'));
    expect(backupNames).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(pluginsDir, backupNames[0], staleCachedSkillRelativePath), 'utf8')
    ).toBe('# Stale profile skill\n');
  });

  it('merges rollback data when a concurrent cache appears during restoration', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const cacheDir = path.join(profileDir, 'plugins', 'cache');
    const staleSkillPath = path.join(cacheDir, staleCachedSkillRelativePath);
    const concurrentMarkerPath = path.join(cacheDir, 'concurrent-marker.txt');
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staleSkillPath, '# Stale profile skill\n');

    const realSymlinkSync = fs.symlinkSync.bind(fs);
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(
      (...args: Parameters<typeof fs.symlinkSync>) => {
        const [, pathToCreate] = args;
        if (path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          throw Object.assign(new Error('simulated filesystem corruption'), { code: 'EIO' });
        }
        return realSymlinkSync(...args);
      }
    );
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let injectedRestoreRace = false;
    const mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(
      (...args: Parameters<typeof fs.mkdirSync>) => {
        const [pathToCreate] = args;
        if (!injectedRestoreRace && path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          injectedRestoreRace = true;
          realMkdirSync(cacheDir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(concurrentMarkerPath, 'preserve concurrent cache\n');
          throw Object.assign(new Error('simulated concurrent create'), { code: 'EEXIST' });
        }
        return realMkdirSync(...args);
      }
    );

    try {
      expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
        'simulated filesystem corruption'
      );
    } finally {
      mkdirSpy.mockRestore();
      symlinkSpy.mockRestore();
    }

    expect(fs.readFileSync(concurrentMarkerPath, 'utf8')).toBe('preserve concurrent cache\n');
    expect(fs.readFileSync(staleSkillPath, 'utf8')).toBe('# Stale profile skill\n');
    expect(
      fs.readdirSync(path.dirname(cacheDir)).some((name) => name.startsWith('.cache.ccs-backup-'))
    ).toBe(false);
  });

  it('preserves a concurrent non-directory cache path during fallback restoration', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const pluginsDir = path.join(profileDir, 'plugins');
    const cacheDir = path.join(pluginsDir, 'cache');
    const staleSkillPath = path.join(cacheDir, staleCachedSkillRelativePath);
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staleSkillPath, '# Stale profile skill\n');

    const realSymlinkSync = fs.symlinkSync.bind(fs);
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(
      (...args: Parameters<typeof fs.symlinkSync>) => {
        const [, pathToCreate] = args;
        if (path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          throw Object.assign(new Error('simulated Windows symlink denial'), { code: 'EPERM' });
        }
        return realSymlinkSync(...args);
      }
    );
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let injectedRestoreRace = false;
    const mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(
      (...args: Parameters<typeof fs.mkdirSync>) => {
        const [pathToCreate] = args;
        if (!injectedRestoreRace && path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          injectedRestoreRace = true;
          fs.writeFileSync(cacheDir, 'preserve concurrent file\n');
          throw Object.assign(new Error('simulated concurrent create'), { code: 'EEXIST' });
        }
        return realMkdirSync(...args);
      }
    );

    try {
      expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
        'profile cache path is not a local directory'
      );
    } finally {
      mkdirSpy.mockRestore();
      symlinkSpy.mockRestore();
    }

    expect(fs.readFileSync(cacheDir, 'utf8')).toBe('preserve concurrent file\n');
    const backupNames = fs
      .readdirSync(pluginsDir)
      .filter((name) => name.startsWith('.cache.ccs-backup-'));
    expect(backupNames).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(pluginsDir, backupNames[0], staleCachedSkillRelativePath), 'utf8')
    ).toBe('# Stale profile skill\n');
  });

  it('repairs a missing resource link without changing existing shared files', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );

    ensureCodexProfileResources(profileDir, { sharedCodexHome });
    fs.unlinkSync(path.join(profileDir, 'agents'));

    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    const agentsPath = path.join(profileDir, 'agents');
    expect(fs.lstatSync(agentsPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(agentsPath, 'brainstormer.toml'))).toBe(true);
  });

  it('is idempotent for repeated repair calls', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );

    ensureCodexProfileResources(profileDir, { sharedCodexHome });
    const firstTarget = fs.readlinkSync(path.join(profileDir, 'agents'));

    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    expect(fs.readlinkSync(path.join(profileDir, 'agents'))).toBe(firstTarget);
    expect(fs.readFileSync(path.join(profileDir, 'agents', 'brainstormer.toml'), 'utf8')).toContain(
      'brainstormer'
    );
  });

  it('copies missing resource files into an existing profile-local directory', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const agentsPath = path.join(profileDir, 'agents');
    fs.mkdirSync(agentsPath, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(agentsPath, 'local.toml'), 'name = "local"\n');

    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    expect(fs.lstatSync(agentsPath).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(agentsPath, 'local.toml'))).toBe(true);
    expect(fs.existsSync(path.join(agentsPath, 'brainstormer.toml'))).toBe(true);
  });

  it('falls back to copying resources when directory symlinks are unavailable', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('simulated symlink failure'), { code: 'EPERM' });
    });
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;

    try {
      ensureCodexProfileResources(profileDir, { sharedCodexHome });
    } finally {
      process.stderr.write = origWrite;
      symlinkSpy.mockRestore();
    }

    const agentsPath = path.join(profileDir, 'agents');
    expect(fs.lstatSync(agentsPath).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(agentsPath, 'brainstormer.toml'))).toBe(true);
  });

  it('preserves a local plugin cache and copies missing shared entries on EPERM', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    const cacheDir = path.join(profileDir, 'plugins', 'cache');
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(cacheDir, path.dirname(staleCachedSkillRelativePath)), {
      recursive: true,
      mode: 0o700,
    });
    fs.writeFileSync(path.join(cacheDir, 'local-only.txt'), 'keep me\n');
    fs.writeFileSync(path.join(cacheDir, staleCachedSkillRelativePath), '# Existing stale skill\n');

    const realSymlinkSync = fs.symlinkSync.bind(fs);
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(
      (...args: Parameters<typeof fs.symlinkSync>) => {
        const [, pathToCreate] = args;
        if (path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          throw Object.assign(new Error('simulated Windows symlink denial'), { code: 'EPERM' });
        }
        return realSymlinkSync(...args);
      }
    );
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;

    try {
      ensureCodexProfileResources(profileDir, { sharedCodexHome });
    } finally {
      process.stderr.write = origWrite;
      symlinkSpy.mockRestore();
    }

    expect(fs.lstatSync(cacheDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(cacheDir, 'local-only.txt'), 'utf8')).toBe('keep me\n');
    expect(fs.readFileSync(path.join(cacheDir, staleCachedSkillRelativePath), 'utf8')).toBe(
      '# Existing stale skill\n'
    );
    expect(fs.readFileSync(path.join(cacheDir, cachedSkillRelativePath), 'utf8')).toBe(
      '# Current shared skill\n'
    );
  });

  it('restores a stale plugin cache and rethrows an unexpected symlink error', async () => {
    const { ensureCodexProfileResources } = await import(
      '../../../src/codex-auth/codex-profile-resources'
    );
    ensureCodexProfileResources(profileDir, { sharedCodexHome });

    const pluginsDir = path.join(profileDir, 'plugins');
    const cacheDir = path.join(pluginsDir, 'cache');
    const siblingPath = path.join(pluginsDir, 'marketplaces.json');
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(cacheDir, 'local-only.txt'), 'restore me\n');
    fs.writeFileSync(siblingPath, '{"preserve":true}\n');

    const realSymlinkSync = fs.symlinkSync.bind(fs);
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(
      (...args: Parameters<typeof fs.symlinkSync>) => {
        const [, pathToCreate] = args;
        if (path.resolve(String(pathToCreate)) === path.resolve(cacheDir)) {
          throw Object.assign(new Error('simulated filesystem corruption'), { code: 'EIO' });
        }
        return realSymlinkSync(...args);
      }
    );

    try {
      expect(() => ensureCodexProfileResources(profileDir, { sharedCodexHome })).toThrow(
        'simulated filesystem corruption'
      );
    } finally {
      symlinkSpy.mockRestore();
    }

    expect(fs.lstatSync(cacheDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(cacheDir, 'local-only.txt'), 'utf8')).toBe('restore me\n');
    expect(fs.existsSync(path.join(cacheDir, cachedSkillRelativePath))).toBe(false);
    expect(fs.readFileSync(siblingPath, 'utf8')).toBe('{"preserve":true}\n');
  });
});
