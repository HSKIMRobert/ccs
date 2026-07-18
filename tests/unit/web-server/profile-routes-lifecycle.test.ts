import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import profileRoutes from '../../../src/web-server/routes/profile-routes';

describe('profile-routes lifecycle endpoints', () => {
  let server: Server;
  let baseUrl = '';
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/profiles', profileRoutes);

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1');
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve test server port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-profile-routes-lifecycle-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('rejects unknown fields on profile create payload', async () => {
    const response = await fetch(`${baseUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'demo',
        baseUrl: 'https://api.example.com',
        apiKey: 'token',
        unknownField: true,
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Unknown profile field(s)');
  });

  it('does not register all orphans when names=[] is explicitly passed', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: {} }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'lonely.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );

    const response = await fetch(`${baseUrl}/api/profiles/orphans/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: [] }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { registered: string[]; skipped: Array<unknown> };
    expect(body.registered).toEqual([]);
    expect(body.skipped).toEqual([]);
  });

  it('rejects malformed names payload for orphan registration', async () => {
    const response = await fetch(`${baseUrl}/api/profiles/orphans/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: 'lonely' }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('names must be an array');
  });

  it('rejects import bundle with invalid profile target', async () => {
    const response = await fetch(`${baseUrl}/api/profiles/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundle: {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          profile: { name: 'demo', target: 'invalid' },
          settings: {
            env: {
              ANTHROPIC_BASE_URL: 'https://api.example.com',
              ANTHROPIC_AUTH_TOKEN: 'token',
            },
          },
        },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Invalid bundle profile target');
  });

  it('validates source profile name on export endpoint', async () => {
    const response = await fetch(`${baseUrl}/api/profiles/1invalid/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('API name must start with letter');
  });

  it('keeps grandfathered profiles exportable, copyable, and removable', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { xai: '~/.ccs/xai.settings.json' } }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'xai.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );

    const exportResponse = await fetch(`${baseUrl}/api/profiles/xai/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(exportResponse.status).toBe(200);

    const copyResponse = await fetch(`${baseUrl}/api/profiles/xai/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: 'xai-backup' }),
    });
    expect(copyResponse.status).toBe(201);

    const reservedDestinationResponse = await fetch(`${baseUrl}/api/profiles/xai/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: 'GROK' }),
    });
    expect(reservedDestinationResponse.status).toBe(400);
    const reservedDestinationBody = (await reservedDestinationResponse.json()) as {
      error: string;
    };
    expect(reservedDestinationBody.error).toContain('reserved name');

    const deleteResponse = await fetch(`${baseUrl}/api/profiles/xai`, {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    expect(fs.existsSync(path.join(ccsDir, 'xai.settings.json'))).toBe(false);
  });

  it('recovers a grandfathered xai orphan through the route', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: {} }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'xai.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );

    const response = await fetch(`${baseUrl}/api/profiles/orphans/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: ['xai'] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { registered: string[]; skipped: unknown[] };
    expect(body.registered).toEqual(['xai']);
    expect(body.skipped).toEqual([]);

    const config = JSON.parse(fs.readFileSync(path.join(ccsDir, 'config.json'), 'utf8')) as {
      profiles: Record<string, string>;
    };
    expect(config.profiles.xai).toBe('~/.ccs/xai.settings.json');
  });
});
