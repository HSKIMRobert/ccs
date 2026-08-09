const http = require('node:http');
const path = require('node:path');

const repoRoot = process.env.CCS_RUNTIME_PROBE_ROOT || process.cwd();
const {
  closeOpenAICompatProxyServer,
  startOpenAICompatProxyServer,
} = require(path.join(repoRoot, 'dist/proxy/server/proxy-server.js'));

function waitForListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
  });
}

function request(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method || 'GET',
        headers: options.headers,
        agent: options.agent,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      }
    );
    req.once('error', reject);
    req.end(options.body);
  });
}

async function startProbeServer() {
  const server = startOpenAICompatProxyServer({
    profile: {
      profileName: 'sentinel',
      settingsPath: '/tmp/sentinel.settings.json',
      baseUrl: process.env.CCS_RUNTIME_PROBE_UPSTREAM,
      apiKey: 'sentinel-api-key-not-real',
      provider: 'generic-chat-completion-api',
      model: 'sentinel-model',
      passthrough: false,
    },
    port: 0,
    authToken: 'sentinel-local-token',
  });
  await waitForListening(server);
  return server;
}

async function runTransportProbe() {
  const server = await startProbeServer();
  const port = server.address().port;
  const response = await request(port, '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'sentinel-local-token',
    },
    body: JSON.stringify({
      model: 'sentinel-model',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  await closeOpenAICompatProxyServer(server, 250);
  const parsed = JSON.parse(response.body);
  console.log(
    JSON.stringify({
      status: response.status,
      text: parsed.content?.[0]?.text,
      error: parsed.error?.message,
    })
  );
}

async function runShutdownProbe() {
  const server = await startProbeServer();
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: true });
  await request(port, '/health', { agent });
  const startedAt = Date.now();
  await closeOpenAICompatProxyServer(server, 250);
  const elapsedMs = Date.now() - startedAt;
  agent.destroy();
  console.log(JSON.stringify({ closed: !server.listening, elapsedMs }));
}

const mode = process.env.CCS_RUNTIME_PROBE_MODE || 'transport';
Promise.resolve(mode === 'shutdown' ? runShutdownProbe() : runTransportProbe()).catch((error) => {
  console.error(JSON.stringify({ name: error.name, message: error.message }));
  process.exitCode = 1;
});
