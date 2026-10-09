const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { id, sha256, toUtf8Bytes } = require('ethers');
const { createServer } = require('../app-server');
const { checkLinks } = require('../lib/network');

describe('PolicyGuard persistent application acceptance', () => {
  let instance, base, admin, alice, bob, clara, david, policy, reference;
  const root = path.join(__dirname, '../test-output', crypto.randomUUID());
  const directory = path.join(root, 'data');
  async function boot() {
    instance = await createServer({ directory, blockTime: 0, autoStart: false, adminPassword: 'AdminTest123!' });
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${instance.server.address().port}`;
  }
  before(boot);
  after(async () => { if (instance) await instance.close(); });
  async function request(client, route, body, key = crypto.randomUUID()) {
    const response = await fetch(`${base}/api${route}`, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(client?.cookie ? { Cookie: client.cookie } : {}), 'Content-Type': 'application/json',
      'X-PolicyGuard-Request': '1', 'X-CSRF-Token': client?.csrf || '', 'Idempotency-Key': key
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (client && cookie) client.cookie = cookie;
    if (client && data.csrf) { client.csrf = data.csrf; client.user = data.user; }
    return { status: response.status, data };
  }
  async function signup(username, role) {
    const client = {};
    const result = await request(client, '/auth/signup', { username, role, password: 'AccountTest123!', name: username.toUpperCase(), email: `${username}@example.com`, phone: '+91 98765 43210' });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    await instance.app.drain();
    return client;
  }
  async function action(client, route, body, key) {
    const response = await request(client, route, body, key);
    assert.equal(response.status, 202, JSON.stringify(response.data));
    await instance.app.drain();
    const result = await request(client, `/operations/${response.data.operationId}`);
    assert.equal(result.data.state, 'synchronised', JSON.stringify(result.data));
    return result.data;
  }
  it('logs in the administrator and separates customer / pending agent registration', async () => {
    admin = {};
    assert.equal((await request(admin, '/auth/login', { username: 'admin', password: 'AdminTest123!', role: 'admin' })).status, 200);
    alice = await signup('alice', 'agent'); bob = await signup('bob', 'agent');
    clara = await signup('clara', 'customer'); david = await signup('david', 'customer');
    assert.equal(alice.user.employment.status, 'pending');
    assert.equal((await request(clara, '/customer/dashboard')).data.balance, 50000000);
    assert.equal((await request(alice, '/agent/dashboard')).status, 403);
  });
  it('rejects duplicate usernames, wrong passwords, role confusion and anonymous access', async () => {
    assert.equal((await request({}, '/auth/signup', { username: 'clara', role: 'customer', password: 'AnotherTest123!', name: 'Another', email: 'a@b.com', phone: '9876543210' })).status, 409);
    assert.equal((await request({}, '/auth/login', { username: 'clara', password: 'WrongPass123', role: 'customer' })).status, 401);
    assert.equal((await request({}, '/auth/login', { username: 'clara', password: 'AccountTest123!', role: 'agent' })).status, 401);
    assert.equal((await request({}, '/customer/dashboard')).status, 401);
    assert.equal((await request(clara, '/admin/dashboard')).status, 403);
  });
  it('rejects cross-site writes and missing CSRF tokens', async () => {
    const options = { method: 'POST', headers: { Cookie: admin.cookie, 'Content-Type': 'application/json', 'X-PolicyGuard-Request': '1' }, body: '{}' };
    assert.equal((await fetch(`${base}/api/auth/logout`, options)).status, 403);
    assert.equal((await fetch(`${base}/api/auth/logout`, { ...options, headers: { ...options.headers, Origin: 'https://evil.example' } })).status, 403);
  });
  it('administrator approval becomes employment on both independent chains', async () => {
    instance.app.faults.relayPaused = true;
    const approval = await request(admin, `/admin/agents/${alice.user.id}/approve`, {});
    assert.equal(approval.status, 202); await instance.app.drain();
    const waiting = (await request(alice, '/auth/me')).data.user.employment;
    assert.equal(waiting.recordedStatus, 'employed'); assert.equal(waiting.status, 'pending');
    assert.equal(waiting.synchronising, true); assert.equal((await request(alice, '/agent/dashboard')).status, 403);
    instance.app.faults.relayPaused = false; await instance.app.drain();
    assert.equal((await request(admin, `/operations/${approval.data.operationId}`)).data.state, 'synchronised');
    await action(admin, `/admin/agents/${bob.user.id}/approve`, {});
    const { networks } = instance.app;
    assert.equal(Number((await networks.agent.contract.agents(alice.user.address)).status), 1);
    assert.equal(await networks.customer.contract.employed(alice.user.address), true);
    assert.equal(Number((await networks.customer.provider.getNetwork()).chainId), 1337);
    assert.equal(Number((await networks.agent.provider.getNetwork()).chainId), 1338);
  });
  it('purchases a fixed plan, assigns the least-loaded agent, and fixes original terms', async () => {
    await action(clara, '/customer/purchase', { planId: 2 });
    const dashboard = (await request(clara, '/customer/dashboard')).data;
    assert.equal(dashboard.policies.length, 1);
    policy = dashboard.policies[0].policyId; reference = dashboard.policies[0].reference;
    assert.equal(dashboard.policies[0].currentAgent.id, alice.user.id);
    assert.equal(dashboard.policies[0].originalAgent.id, alice.user.id);
    assert.equal(dashboard.policies[0].premium, 2500000);
    assert.equal(dashboard.policies[0].years, 3);
    assert.equal(dashboard.policies[0].bonus, 1000000);
    assert.equal(dashboard.balance, 47500000);
    assert.equal(dashboard.policies[0].termsHash, sha256(toUtf8Bytes(dashboard.policies[0].terms)));
    await action(david, '/customer/purchase', { planId: 1 });
    assert.equal((await request(david, '/customer/dashboard')).data.policies[0].currentAgent.id, bob.user.id);
  });
  it('prevents cross-customer reads and agent policy mutations, including forged user IDs', async () => {
    assert.equal((await request(david, `/customer/policies/${policy}`)).status, 404);
    assert.equal((await request(alice, `/customer/policies/${policy}/cancel`, { userId: clara.user.id })).status, 403);
    assert.equal((await request(clara, '/agent/resign', { userId: alice.user.id, confirmed: true })).status, 403);
    assert.equal((await request(alice, '/admin/dashboard')).status, 403);
    assert.equal((await request(alice, '/agent/dashboard')).data.policies.length, 1);
  });
  it('records sequential premiums and prevents duplicate payment requests', async () => {
    const key = crypto.randomUUID();
    await action(clara, `/customer/policies/${policy}/pay`, { instalment: 2 }, key);
    await action(clara, `/customer/policies/${policy}/pay`, { instalment: 2 }, key);
    assert.equal((await request(clara, `/customer/policies/${policy}`)).data.paidCount, 2);
    const stale = await request(clara, `/customer/policies/${policy}/pay`, { instalment: 2 }); await instance.app.drain();
    assert.equal((await request(clara, `/operations/${stale.data.operationId}`)).data.state, 'needs_attention');
    assert.equal((await request(clara, `/customer/policies/${policy}`)).data.paidCount, 2);
  });
  it('retains all customer policies with their current agent', async () => {
    await action(clara, '/customer/purchase', { planId: 1 });
    assert.ok((await request(clara, '/customer/dashboard')).data.policies.every(item => item.currentAgent.id === alice.user.id));
  });
  it('detects changed policy documents and preserves their recorded hash', async () => {
    const detail = (await request(clara, `/customer/policies/${policy}`)).data;
    assert.equal((await request(clara, `/customer/policies/${policy}/verify`, { text: detail.terms })).data.matches, true);
    assert.equal((await request(clara, `/customer/policies/${policy}/verify`, { text: detail.terms.replace('INR 10000', 'INR 90000') })).data.matches, false);
  });
  it('resignation revokes existing sessions and reassigns customers without changing onboarding history', async () => {
    const secondSession = {};
    await request(secondSession, '/auth/login', { username: 'alice', password: 'AccountTest123!', role: 'agent' });
    await action(alice, '/agent/resign', { confirmed: true });
    for (const route of ['/agent/dashboard', '/plans', '/notifications', '/explorer/blocks', `/customer/policies/${policy}`]) {
      assert.equal((await request(alice, route)).status, 403, route);
      assert.equal((await request(secondSession, route)).status, 403, route);
    }
    assert.equal((await request(alice, '/agent/status')).data.employment.status, 'resigned');
    assert.equal((await request(alice, '/agent/resign', { confirmed: true })).status, 403);
    const detail = (await request(clara, `/customer/policies/${policy}`)).data;
    assert.equal(detail.originalAgent.id, alice.user.id); assert.equal(detail.originalAgent.employment.status, 'resigned');
    assert.equal(detail.currentAgent.id, bob.user.id); assert.equal(detail.currentAgent.email, 'bob@example.com');
    assert.equal(detail.paid, 5000000); assert.equal(detail.bonus, 1000000);
  });
  it('quotes a 10% cancellation fee, refunds once and notifies the current agent', async () => {
    const quote = (await request(clara, `/customer/policies/${policy}/quote`)).data;
    assert.equal(quote.fee, 500000); assert.equal(quote.refund, 4500000);
    assert.equal((await request(clara, `/customer/policies/${policy}/cancel`, quote)).status, 400);
    const key = crypto.randomUUID(), balanceBefore = (await request(clara, '/customer/dashboard')).data.balance;
    await action(clara, `/customer/policies/${policy}/cancel`, { ...quote, acknowledged: true }, key);
    await action(clara, `/customer/policies/${policy}/cancel`, { ...quote, acknowledged: true }, key);
    const detail = (await request(clara, `/customer/policies/${policy}`)).data;
    assert.equal(detail.status, 'cancelled'); assert.equal(detail.fee, 500000); assert.equal(detail.returnedAmount, 4500000);
    assert.equal((await request(clara, '/customer/dashboard')).data.balance, balanceBefore + 4500000);
    assert.ok((await request(bob, '/notifications')).data.notifications.some(item => item.message.includes('Fee INR 5000')));
    assert.equal(Number((await instance.app.networks.agent.contract.policies(policy)).fee), 500000);
  });
  it('handles no replacement and assigns awaiting customers when a new agent is approved', async () => {
    await action(bob, '/agent/resign', { confirmed: true });
    assert.equal((await request(clara, `/customer/policies/${policy}`)).data.currentAgent, null);
    assert.ok((await request(admin, '/admin/dashboard')).data.awaitingAssignment.length > 0);
    const eve = await signup('eve', 'agent');
    await action(admin, `/admin/agents/${eve.user.id}/approve`, {});
    assert.equal((await request(clara, `/customer/policies/${policy}`)).data.currentAgent.id, eve.user.id);
  });
  it('rejects direct contract calls from unauthorised accounts and deduplicates source operations', async () => {
    const { networks, signer, getUser } = instance.app;
    await assert.rejects(networks.agent.contract.connect(signer(getUser(clara.user.id), 'agent')).decideAgent.staticCall(bob.user.address, 10, true, id('illegal')), /Only administrator/);
    await assert.rejects(networks.customer.contract.connect(signer(getUser(clara.user.id), 'customer')).mirrorEmployment.staticCall(id('bad-relay'), bob.user.address, true), /Only relay/);
    const grant = instance.app.store.get("SELECT id FROM operations WHERE user_id=? AND kind='register'", clara.user.id);
    await assert.rejects(networks.customer.contract.registerCustomer.staticCall(clara.user.address, id(grant.id)), /Operation already applied/);
    const old = await networks.customer.contract.getPolicy(policy);
    await assert.rejects(networks.customer.contract.connect(signer(getUser(clara.user.id), 'customer')).cancel.staticCall(policy, old.termsHash, 5000000, 500000, id('second-close')), /Policy is closed/);
  });
  it('shows real blocks, previous/current/next links, receipts and cross-chain references', async () => {
    const list = (await request(clara, '/explorer/blocks?chain=customer')).data;
    assert.equal(list.chainId, 1337); assert.ok(list.blocks.length > 1);
    const height = Number(BigInt(list.blocks[1].number));
    const detail = (await request(clara, `/explorer/blocks/${height}?chain=customer`)).data;
    assert.equal(detail.linksValid, true); assert.equal(detail.block.parentHash, detail.previous.hash); assert.ok(detail.next);
    const latest = (await request(clara, `/explorer/blocks/${list.head}?chain=customer`)).data;
    assert.equal(latest.next, null);
    assert.equal((await request(clara, '/explorer/integrity?chain=customer')).data.valid, true);
    const event = instance.app.store.get("SELECT tx_hash FROM events WHERE name='PolicyClosed'");
    const receipt = (await request(clara, `/explorer/transactions/${event.tx_hash}?chain=customer`)).data;
    assert.equal(receipt.action, 'cancel'); assert.ok(receipt.links.length); assert.ok(receipt.events.length);
  });
  it('detects corrupted parent links and receipt memberships in independent check inputs', async () => {
    const network = instance.app.networks.customer;
    const head = await network.provider.getBlockNumber(), blocks = [], receipts = {};
    for (let index = Math.max(1, head - 2); index <= head; index++) {
      const block = await network.rpc.request({ method: 'eth_getBlockByNumber', params: [`0x${index.toString(16)}`, false] }); blocks.push(block);
      for (const hash of block.transactions) receipts[hash] = await network.rpc.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    }
    assert.equal(checkLinks(blocks, receipts).valid, true);
    const corrupt = structuredClone(blocks); corrupt[1].parentHash = id('wrong');
    assert.equal(checkLinks(corrupt, receipts).valid, false);
    const badReceipts = structuredClone(receipts); const first = Object.keys(badReceipts)[0]; badReceipts[first].transactionIndex = '0xffff';
    assert.equal(checkLinks(blocks, badReceipts).valid, false);
  });
  it('preserves accounts, policies, sessions and pending relay jobs through restart without double charging', async () => {
    instance.app.faults.relayPaused = true;
    const response = await request(clara, '/customer/purchase', { planId: 3 }); await instance.app.drain();
    const opId = response.data.operationId;
    assert.equal((await request(clara, `/operations/${opId}`)).data.state, 'synchronising');
    const balance = (await request(clara, '/customer/dashboard')).data.balance;
    const address = await instance.app.networks.customer.contract.getAddress();
    await instance.close(); instance = null; await boot(); await instance.app.drain();
    assert.equal((await request(clara, '/auth/me')).status, 200);
    assert.equal((await request(clara, `/operations/${opId}`)).data.state, 'synchronised');
    assert.equal((await request(clara, '/customer/dashboard')).data.balance, balance);
    assert.equal(await instance.app.networks.customer.contract.getAddress(), address);
    assert.equal((await request(clara, `/customer/policies/${policy}`)).data.reference, reference);
    const delivered = instance.app.store.get("SELECT * FROM relay_jobs WHERE state='synchronised' LIMIT 1");
    const count = instance.app.store.get('SELECT COUNT(*) n FROM notifications').n;
    instance.app.store.run("UPDATE relay_jobs SET state='pending' WHERE event_key=?", delivered.event_key);
    await instance.app.drain();
    assert.equal(instance.app.store.get('SELECT COUNT(*) n FROM notifications').n, count);
  });
  it('handles maturity boundaries, outstanding premiums, payment caps and one-time claims', async () => {
    const network = instance.app.networks.customer;
    const active = (await request(clara, '/customer/dashboard')).data.policies.find(item => item.plan === 3);
    const wallet = instance.app.signer(instance.app.getUser(clara.user.id), 'customer');
    await assert.rejects(network.contract.connect(wallet).claim.staticCall(active.policyId, id('too-early')), /Not mature yet/);
    await network.rpc.request({ method: 'evm_mine', params: [{ timestamp: active.maturityAt - 1 }] });
    assert.equal((await request(clara, `/customer/policies/${active.policyId}`)).data.canCancel, true);
    await network.rpc.request({ method: 'evm_mine', params: [{ timestamp: active.maturityAt }] });
    assert.equal((await request(clara, `/customer/policies/${active.policyId}`)).data.canCancel, false);
    await assert.rejects(network.contract.connect(wallet).claim.staticCall(active.policyId, id('unpaid')), /Outstanding premiums/);
    for (let instalment = 2; instalment <= 5; instalment++) await action(clara, `/customer/policies/${active.policyId}/pay`, { instalment });
    await assert.rejects(network.contract.connect(wallet).payPremium.staticCall(active.policyId, 6, id('extra')), /All premiums paid/);
    const before = (await request(clara, '/customer/dashboard')).data.balance;
    await action(clara, `/customer/policies/${active.policyId}/claim`, {});
    assert.equal((await request(clara, '/customer/dashboard')).data.balance, before + 24000000);
    await assert.rejects(network.contract.connect(wallet).claim.staticCall(active.policyId, id('again')), /Policy is closed/);
  });
  it('resumes the exact signed source transaction after an interrupted broadcast and restart', async () => {
    const network = instance.app.networks.customer;
    const broadcast = network.provider.broadcastTransaction.bind(network.provider);
    network.provider.broadcastTransaction = async () => { throw new Error('Simulated connection loss before broadcast'); };
    const balance = (await request(david, '/customer/dashboard')).data.balance;
    const pending = await request(david, '/customer/purchase', { planId: 1 });
    await instance.app.drain();
    const saved = instance.app.store.get('SELECT * FROM operations WHERE id=?', pending.data.operationId);
    assert.equal(saved.state, 'needs_attention'); assert.ok(saved.raw_tx); assert.ok(saved.source_tx);
    network.provider.broadcastTransaction = broadcast;
    await instance.close(); instance = null; await boot(); await instance.app.drain();
    const result = (await request(david, `/operations/${pending.data.operationId}`)).data;
    assert.equal(result.state, 'synchronised'); assert.equal(result.transactionHash, saved.source_tx);
    assert.equal((await request(david, '/customer/dashboard')).data.balance, balance - 1200000);
    await instance.app.drain();
    assert.equal((await request(david, '/customer/dashboard')).data.balance, balance - 1200000);
  });
  it('keeps rejected applicants out and throttles repeated incorrect passwords', async () => {
    const applicant = await signup('rejected_applicant', 'agent');
    await action(admin, `/admin/agents/${applicant.user.id}/reject`, {});
    assert.equal((await request(applicant, '/agent/status')).data.employment.status, 'rejected');
    assert.equal((await request(applicant, '/explorer/blocks')).status, 403);
    for (let i = 0; i < 8; i++) assert.equal((await request({}, '/auth/login', { username: 'not_an_account', password: 'incorrect', role: 'agent' })).status, 401);
    assert.equal((await request({}, '/auth/login', { username: 'not_an_account', password: 'incorrect', role: 'agent' })).status, 429);
  });
  it('fails closed when authoritative agent employment cannot be verified', async () => {
    const eve = {};
    await request(eve, '/auth/login', { username: 'eve', password: 'AccountTest123!', role: 'agent' });
    const employment = instance.app.employment;
    instance.app.employment = async () => { throw new Error('Simulated agent-chain outage'); };
    try {
      for (const route of ['/agent/dashboard', '/plans', '/notifications', '/explorer/blocks']) {
        const result = await request(eve, route);
        assert.notEqual(result.status, 200); assert.deepEqual(Object.keys(result.data), ['error']);
      }
    } finally { instance.app.employment = employment; }
  });
  it('rejects incomplete persisted storage instead of silently resetting it', async () => {
    const broken = path.join(root, 'incomplete'); fs.mkdirSync(broken);
    await assert.rejects(createServer({ directory: broken, blockTime: 0 }), /Incomplete application storage/);
  });
});
