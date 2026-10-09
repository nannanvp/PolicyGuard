const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { digest } = require('../lib/storage');

function health(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 600 }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); }); req.on('error', () => resolve(null));
  });
}
function freePort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
function openBrowser(url) {
  if (process.env.POLICYGUARD_NO_BROWSER === '1') return;
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => console.log(`Open this address in your browser: ${url}`)); child.unref();
  }
}
async function launch() {
  const directory = path.resolve(process.env.POLICYGUARD_DATA || path.join(__dirname, '../data'));
  const identity = digest(directory).slice(0, 16);
  const first = Number(process.env.PORT || 3000);
  if (!Number.isInteger(first) || first < 1024 || first > 65000) throw new Error('Use a PORT between 1024 and 65000.');
  let available;
  for (let port = first; port < first + 10; port++) {
    const existing = await health(port);
    if (existing?.application === 'PolicyGuard' && existing.instance === identity) {
      const url = `http://127.0.0.1:${port}`; console.log(`This installation is already running: ${url}`); openBrowser(url); return;
    }
    if (available === undefined && await freePort(port)) available = port;
  }
  if (available === undefined) throw new Error('No available local port. Close an older server or set PORT to another number.');
  const { createServer } = require('../app-server');
  const instance = await createServer({ directory });
  try {
    await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(available, '127.0.0.1', resolve); });
  } catch (error) { await instance.close(); throw error; }
  const url = `http://127.0.0.1:${available}`;
  console.log(`\nPolicyGuard ready: ${url}\nTwo persistent local Ethereum chains: 1337 and 1338.\n\nAdministrator login: ${path.join(directory, 'INITIAL_ADMIN.txt')}`);
  if (fs.existsSync(path.join(directory, 'SAMPLE_ACCOUNTS.txt'))) console.log(`Sample logins: ${path.join(directory, 'SAMPLE_ACCOUNTS.txt')}`);
  console.log('\nKeep this window open while using the website. Press Ctrl+C to stop.');
  openBrowser(url);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await instance.close(); process.exit(0); });
  return instance;
}
if (require.main === module) launch().catch(error => { console.error(`PolicyGuard could not start: ${error.message}`); process.exitCode = 1; });
module.exports = { launch, health, freePort };
