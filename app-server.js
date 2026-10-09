const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256, toUtf8Bytes } = require('ethers');
const { createApplication, PLANS, cleanError } = require('./lib/application');
const { checkPassword, digest } = require('./lib/storage');
const { checkLinks } = require('./lib/network');

function fault(status, message) { const error = new Error(message); error.status = status; throw error; }
function number(value, min, max) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) fault(400, 'Invalid numeric value.');
  return result;
}
async function readBody(request) {
  let text = '';
  for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 65536) fault(413, 'Request too large.'); }
  try { return JSON.parse(text || '{}'); } catch { fault(400, 'Invalid JSON.'); }
}
const publicUser = row => ({ id: row.id, username: row.username, name: row.name, email: row.email, phone: row.phone, role: row.role, address: row.address });

async function createServer(options = {}) {
  const app = await createApplication(options), { store, networks } = app;
  let registrationQueue = Promise.resolve();
  const streams = new Set();
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  function sessionCookie(res, token, age = 28800) { res.setHeader('Set-Cookie', `pg_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`); }
  function createSession(res, user) {
    const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex');
    store.run('INSERT INTO sessions VALUES(?,?,?,?)', digest(token), user.id, csrf, Date.now() + 8 * 3600000);
    sessionCookie(res, token); return csrf;
  }
  function authenticate(request) {
    const token = /(?:^|;\s*)pg_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
    if (!token) return null;
    const session = store.get('SELECT * FROM sessions WHERE token=? AND expires>?', digest(token), Date.now());
    return session ? { session, user: app.getUser(session.user_id) } : null;
  }
  async function routes(request, response, url, body, context) {
    const route = url.pathname.slice(4), method = request.method;
    if (route === '/health' && method === 'GET') return { application: 'PolicyGuard', version: '0.2.0', instance: digest(path.resolve(store.directory)).slice(0, 16) };
    const authentication = authenticate(request), user = authentication?.user;
    async function requireRole(...roles) {
      if (!user) fault(401, 'Please sign in.');
      if (roles.length && !roles.includes(user.role)) fault(403, 'This action is not available to your account.');
      if (user.role === 'agent') {
        context.agentSensitive = true;
        if ((await app.employment(user)).status !== 'employed') fault(403, 'Customer and policy access is unavailable for this employment status.');
      }
      return user;
    }
    if (method === 'POST' && request.headers['x-policyguard-request'] !== '1') fault(403, 'Same-origin application request required.');
    if (method === 'POST' && !['/auth/login', '/auth/signup'].includes(route)) {
      if (!authentication) fault(401, 'Please sign in.');
      if (request.headers['x-csrf-token'] !== authentication.session.csrf) fault(403, 'Session verification failed. Reload and try again.');
    }
    if (route === '/auth/signup' && method === 'POST') {
      if (!['customer', 'agent'].includes(body.role)) fault(400, 'Choose Customer or Agent.');
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,30}$/.test(username)) fault(400, 'Username must use 3–30 letters, numbers or underscores.');
      if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) fault(400, 'Use a password with 10–128 characters.');
      const name = String(body.name || '').trim(), email = String(body.email || '').trim(), phone = String(body.phone || '').trim();
      if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || !/^[+\d ()-]{8,22}$/.test(phone)) fault(400, 'Enter your name, a valid email and a contact phone number.');
      // Serialise account creation so uniqueness is also reliable under simultaneous submissions.
      const create = registrationQueue.then(async () => {
        if (store.get('SELECT id FROM users WHERE username=?', username)) fault(409, 'That username is already taken.');
        return app.addUser({ username, password: body.password, role: body.role, name, email, phone });
      });
      registrationQueue = create.catch(() => {});
      const created = await create, csrf = createSession(response, created);
      const operationId = created.role === 'customer' ? app.enqueue(created, 'register', {}, 'signup-credit') : null;
      return { user: await app.profile(created), csrf, operationId };
    }
    if (route === '/auth/login' && method === 'POST') {
      const username = String(body.username || '').trim().toLowerCase();
      const throttleKey = digest(`${request.socket.remoteAddress}:${username}`), ipKey = digest(`ip:${request.socket.remoteAddress}`);
      for (const key of [throttleKey, ipKey]) {
        const record = store.get('SELECT * FROM login_attempts WHERE key=?', key);
        if (record && record.until_time > Date.now() && record.count >= (key === ipKey ? 50 : 8)) fault(429, 'Too many login attempts. Try again in 15 minutes.');
      }
      const candidate = store.get('SELECT * FROM users WHERE username=?', username);
      const valid = candidate && typeof body.password === 'string' && body.password.length <= 128 && await checkPassword(body.password, candidate.password);
      if (!valid || candidate.role !== body.role) {
        for (const key of [throttleKey, ipKey]) {
          const old = store.get('SELECT * FROM login_attempts WHERE key=?', key);
          store.run('INSERT OR REPLACE INTO login_attempts VALUES(?,?,?)', key, old && old.until_time > Date.now() ? old.count + 1 : 1, Date.now() + 15 * 60000);
        }
        fault(401, 'Incorrect username, password or portal.');
      }
      store.run('DELETE FROM login_attempts WHERE key=?', throttleKey);
      return { user: await app.profile(candidate), csrf: createSession(response, candidate) };
    }
    if (route === '/auth/me' && method === 'GET') {
      if (!user) fault(401, 'Please sign in.');
      return { user: await app.profile(user), csrf: authentication.session.csrf };
    }
    if (route === '/auth/logout' && method === 'POST') {
      store.run('DELETE FROM sessions WHERE token=?', authentication.session.token); sessionCookie(response, '', 0); return { ok: true };
    }
    if (!user) fault(401, 'Please sign in.');
    const operationMatch = /^\/operations\/([a-f0-9-]{36})$/.exec(route);
    if (operationMatch && method === 'GET') {
      const operation = store.get('SELECT * FROM operations WHERE id=? AND user_id=?', operationMatch[1], user.id);
      if (!operation) fault(404, 'Operation not found.');
      if (user.role === 'agent' && operation.kind !== 'resign') await requireRole('agent');
      return { id: operation.id, kind: operation.kind, state: operation.state, sourceChain: operation.source_chain,
        transactionHash: operation.source_tx, error: operation.error };
    }
    function action(kind, input) {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) fault(400, 'A valid request identifier is required.');
      context.status = 202; return { operationId: app.enqueue(user, kind, input, key) };
    }
    if (route === '/plans' && method === 'GET') { await requireRole('customer', 'agent', 'admin'); return { plans: PLANS }; }
    if (route === '/customer/dashboard' && method === 'GET') {
      await requireRole('customer');
      return { policies: await app.listPolicies(user), balance: Number(await networks.customer.contract.balances(user.address)),
        registered: await networks.customer.contract.customers(user.address), support: { name: 'Sahana Life', email: 'support@sahana.example', phone: '+91 80000 00000' } };
    }
    if (route === '/customer/purchase' && method === 'POST') { await requireRole('customer'); return action('purchase', { planId: number(body.planId, 1, 3) }); }
    const policyMatch = /^\/customer\/policies\/(0x[a-fA-F0-9]{64})(?:\/(pay|quote|cancel|claim|verify))?$/.exec(route);
    if (policyMatch) {
      await requireRole('customer');
      const policyId = policyMatch[1];
      let policy;
      try { policy = await app.policyDetails(policyId, user); } catch { fault(404, 'Policy not found.'); }
      const sub = policyMatch[2];
      if (!sub && method === 'GET') return policy;
      if (sub === 'quote' && method === 'GET') {
        const quote = await networks.customer.contract.cancellationQuote(policyId);
        return { policyId, paid: Number(quote.paid), fee: Number(quote.fee), refund: Number(quote.refund), bonusForfeited: policy.bonus, termsHash: policy.termsHash };
      }
      if (sub === 'pay' && method === 'POST') return action('pay', { policyId, instalment: number(body.instalment, 1, 5) });
      if (sub === 'claim' && method === 'POST') return action('claim', { policyId });
      if (sub === 'cancel' && method === 'POST') {
        if (body.acknowledged !== true || !/^0x[a-fA-F0-9]{64}$/.test(body.termsHash || '')) fault(400, 'Review and acknowledge the cancellation quote.');
        return action('cancel', { policyId, termsHash: body.termsHash, paid: number(body.paid, 1, 1000000000), fee: number(body.fee, 0, 1000000000) });
      }
      if (sub === 'verify' && method === 'POST') {
        if (typeof body.text !== 'string' || !body.text.length) fault(400, 'Paste the policy document.');
        const hash = sha256(toUtf8Bytes(body.text)); return { matches: hash === policy.termsHash, hash, recordedHash: policy.termsHash };
      }
    }
    if (route === '/agent/status' && method === 'GET') {
      if (user.role !== 'agent') fault(403, 'Agent account required.');
      const history = store.all("SELECT tx_hash,args,block_number FROM events WHERE chain='agent' AND name='EmploymentChanged' ORDER BY block_number DESC")
        .filter(event => JSON.parse(event.args).agent.toLowerCase() === user.address.toLowerCase())
        .map(event => ({ transactionHash: event.tx_hash, blockNumber: event.block_number, ...JSON.parse(event.args) }));
      return { employment: await app.employment(user), history };
    }
    if (route === '/agent/dashboard' && method === 'GET') { await requireRole('agent'); return { policies: await app.listPolicies(user) }; }
    if (route === '/agent/resign' && method === 'POST') { await requireRole('agent'); if (body.confirmed !== true) fault(400, 'Confirm resignation.'); context.agentSensitive = false; return action('resign', {}); }
    if (route === '/admin/dashboard' && method === 'GET') {
      await requireRole('admin');
      const agents = await Promise.all(store.all("SELECT * FROM users WHERE role='agent' ORDER BY id").map(async row => ({ ...await app.profile(row), customerCount: Number(await networks.agent.contract.customerCounts(row.address)) })));
      const policies = await app.listPolicies(user);
      const jobs = store.all('SELECT j.event_key,j.destination,j.state,j.tx_hash,j.error,j.attempts,e.chain,e.tx_hash source_tx,e.name,e.operation_id FROM relay_jobs j JOIN events e USING(event_key) ORDER BY e.block_number DESC,e.log_index DESC LIMIT 50');
      return { agents, awaitingAssignment: policies.filter(policy => !policy.currentAgent), jobs,
        failedOperations: store.all("SELECT id,kind,state,error FROM operations WHERE state='needs_attention' ORDER BY created_at DESC"),
        workerError: store.meta('workerError') || null };
    }
    const decision = /^\/admin\/agents\/(\d+)\/(approve|reject)$/.exec(route);
    if (decision && method === 'POST') {
      await requireRole('admin'); const applicant = app.getUser(Number(decision[1]));
      if (!applicant || applicant.role !== 'agent') fault(404, 'Agent not found.');
      return action(decision[2], { agentId: applicant.id });
    }
    if (route === '/admin/retry' && method === 'POST') {
      await requireRole('admin');
      const operation = store.get("SELECT * FROM operations WHERE id=? AND state='needs_attention'", String(body.operationId));
      if (!operation) fault(404, 'Failed operation not found.');
      if (operation.source_tx) {
        const receipt = await networks[operation.source_chain].provider.getTransactionReceipt(operation.source_tx);
        if (receipt?.status === 0) fault(400, 'This transaction reverted. Correct the cause and submit a new action.');
      }
      store.run("UPDATE operations SET state='pending',error=NULL WHERE id=?", operation.id);
      app.drain().catch(() => {}); return { ok: true };
    }
    if (route === '/notifications' && method === 'GET') {
      await requireRole('customer', 'agent', 'admin');
      return { notifications: store.all('SELECT id,kind,message,policy_id,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', user.id) };
    }
    if (route === '/notifications/read' && method === 'POST') {
      await requireRole('customer', 'agent', 'admin'); store.run('UPDATE notifications SET read=1 WHERE user_id=?', user.id); return { ok: true };
    }
    if (route.startsWith('/explorer/') && method === 'GET') {
      await requireRole('customer', 'agent', 'admin');
      const chain = url.searchParams.get('chain') || 'customer';
      if (!['customer', 'agent'].includes(chain)) fault(400, 'Unknown chain.');
      const network = networks[chain], head = await network.provider.getBlockNumber();
      const rawBlock = async (height, full = false) => network.rpc.request({ method: 'eth_getBlockByNumber', params: [`0x${height.toString(16)}`, full] });
      const meta = { chain, chainId: network.chainId, contractAddress: await network.contract.getAddress(), head };
      if (route === '/explorer/activity') {
        return { ...meta, transactions: store.all('SELECT tx_hash,block_number,GROUP_CONCAT(DISTINCT name) events FROM events WHERE chain=? GROUP BY tx_hash ORDER BY block_number DESC LIMIT 50', chain) };
      }
      if (route === '/explorer/blocks') {
        const before = url.searchParams.has('before') ? number(url.searchParams.get('before'), 0, head) : head;
        const blocks = [];
        for (let height = before; height >= Math.max(0, before - 11); height--) blocks.push(await rawBlock(height));
        return { ...meta, blocks, olderThan: before >= 12 ? before - 12 : null };
      }
      const blockMatch = /^\/explorer\/blocks\/(\d+)$/.exec(route);
      if (blockMatch) {
        const height = number(blockMatch[1], 0, head), block = await rawBlock(height, true);
        const previous = height ? await rawBlock(height - 1) : null, next = height < head ? await rawBlock(height + 1) : null;
        return { ...meta, block, previous: previous ? { number: previous.number, hash: previous.hash } : null,
          next: next ? { number: next.number, hash: next.hash } : null,
          linksValid: Number(BigInt(block.number)) === height && (!previous || (Number(BigInt(previous.number)) === height - 1 && block.parentHash === previous.hash)) && (!next || (Number(BigInt(next.number)) === height + 1 && next.parentHash === block.hash)) };
      }
      if (route === '/explorer/integrity') {
        const end = url.searchParams.has('to') ? number(url.searchParams.get('to'), 0, head) : head;
        const start = url.searchParams.has('from') ? number(url.searchParams.get('from'), 0, end) : Math.max(0, end - 11);
        if (end - start > 99) fault(400, 'Inspect at most 100 blocks per check.');
        const blocks = [], receipts = {};
        for (let height = start; height <= end; height++) {
          const block = await rawBlock(height); blocks.push(block);
          for (const hash of block.transactions) receipts[hash] = await network.rpc.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        }
        return { ...meta, from: start, to: end, ...checkLinks(blocks, receipts) };
      }
      const transactionMatch = /^\/explorer\/transactions\/(0x[a-fA-F0-9]{64})$/.exec(route);
      if (transactionMatch) {
        const hash = transactionMatch[1];
        const transaction = await network.rpc.request({ method: 'eth_getTransactionByHash', params: [hash] });
        if (!transaction) fault(404, 'Transaction not found on this chain.');
        const receipt = await network.rpc.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        let action = 'Contract deployment / transfer', argumentsData = {};
        try {
          const decoded = network.contract.interface.parseTransaction({ data: transaction.input });
          if (decoded) { action = decoded.name; argumentsData = Object.fromEntries(decoded.fragment.inputs.map((input, index) => [input.name, String(decoded.args[index])])); }
        } catch {}
        const events = receipt ? receipt.logs.map(log => { try {
          const parsed = network.contract.interface.parseLog(log);
          return { name: parsed.name, values: Array.from(parsed.args, value => String(value)), fields: Object.fromEntries(parsed.fragment.inputs.map((input, index) => [input.name, String(parsed.args[index])])) };
        } catch { return { name: 'Unrecognised log', values: log.topics }; } }) : [];
        const links = store.all('SELECT j.destination,j.state,j.tx_hash,e.chain source_chain,e.tx_hash source_tx FROM relay_jobs j JOIN events e USING(event_key) WHERE e.tx_hash=? OR j.tx_hash=?', hash, hash);
        return { ...meta, transaction, receipt, action, arguments: argumentsData, events, confirmations: receipt ? head - Number(BigInt(receipt.blockNumber)) + 1 : 0, links };
      }
    }
    fault(404, 'Not found.');
  }

  const server = http.createServer(async (request, response) => {
    const port = server.address().port, allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!allowed.includes(request.headers.host)) fault(403, 'Localhost only.');
      if (request.headers.origin && !allowed.map(host => `http://${host}`).includes(request.headers.origin)) fault(403, 'Cross-origin request rejected.');
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/auth/events' && request.method === 'GET') {
          const auth = authenticate(request); if (!auth) fault(401, 'Please sign in.');
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
          response.write(': connected\n\n'); streams.add(response);
          const listener = change => { if (change.userId === auth.user.id) response.write('data: access-changed\n\n'); };
          app.events.on('employment', listener);
          const heartbeat = setInterval(() => {
            if (!authenticate(request)) response.end(); else response.write(': alive\n\n');
          }, 20000);
          request.on('close', () => { clearInterval(heartbeat); streams.delete(response); app.events.off('employment', listener); });
          return;
        }
        if (!['GET', 'POST'].includes(request.method)) fault(405, 'Method not allowed.');
        const context = {};
        const result = await routes(request, response, url, request.method === 'POST' ? await readBody(request) : null, context);
        if (context.agentSensitive) {
          const authenticated = authenticate(request);
          if (!authenticated || (await app.employment(authenticated.user)).status !== 'employed') fault(403, 'Customer access has been removed.');
        }
        send(response, context.status || 200, result); return;
      }
      const assets = { '/portal.js': ['portal.js', 'text/javascript'], '/portal.css': ['portal.css', 'text/css'] };
      if (request.method !== 'GET') fault(405, 'Method not allowed.');
      const asset = assets[url.pathname] || (/^\/(?:customer|agent|admin)?(?:\/[a-z0-9/-]+)?$/.test(url.pathname) ? ['portal.html', 'text/html'] : null);
      if (!asset) fault(404, 'Not found.');
      const data = await fs.readFile(path.join(__dirname, 'public', asset[0]));
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); response.end(data);
    } catch (error) { send(response, error.status || 400, { error: cleanError(error) }); }
  });
  return { server, app, async close() { for (const stream of streams) stream.end(); if (server.listening) await new Promise(resolve => server.close(resolve)); await app.close(); } };
}

async function start() {
  const instance = await createServer({ directory: process.env.POLICYGUARD_DATA || undefined });
  const port = Number(process.env.PORT || 3000);
  instance.server.on('error', async error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is occupied. Stop the older server or set PORT=3001.` : error.message); await instance.close(); process.exitCode = 1; });
  instance.server.listen(port, '127.0.0.1', () => console.log(`\nPolicyGuard ready: http://127.0.0.1:${port}\nTwo persistent Ethereum chains: 1337 / 1338\nInitial administrator credentials: ${path.join(instance.app.store.directory, 'INITIAL_ADMIN.txt')}\nPress Ctrl+C to stop safely.\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await instance.close(); process.exit(0); });
  return instance;
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createServer, start };
