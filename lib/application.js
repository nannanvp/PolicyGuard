const fs = require('node:fs');
const path = require('node:path');
const { Wallet, id, sha256, toUtf8Bytes, ZeroAddress, keccak256, parseEther } = require('ethers');
const { openStore, hashPassword, uuid } = require('./storage');
const { openNetworks } = require('./network');
const { EventEmitter } = require('node:events');
const PLANS = [
  { id: 1, name: 'Assurance', premium: 1200000, years: 1, bonus: 100000 },
  { id: 2, name: 'Growth', premium: 2500000, years: 3, bonus: 1000000 },
  { id: 3, name: 'Long-Term', premium: 4000000, years: 5, bonus: 4000000 }
];
const YEAR = 365 * 86400;
const asJSON = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function terms(reference, plan) {
  return `SAHANA LIFE — ACADEMIC POLICY\nReference: ${reference}\nPlan: ${plan.name} / version 1\nAnnual premium: INR ${plan.premium / 100}\nAnnual instalments: ${plan.years}\nTerm: ${plan.years * 365} days from the on-chain issue timestamp\nBonus after all instalments and maturity: INR ${plan.bonus / 100}\nEarly cancellation: 10% of premiums paid is retained as a fee; 90% is refunded; the bonus is forfeited.\nAfter maturity: complete outstanding premiums, then claim once.\nInstalments may be paid in advance. No late-payment penalty is modelled.\nAgent replacement does not change these financial terms.\nNo second policy is required to release a bonus.\nAll amounts use non-withdrawable test funds. No real insurance cover, claim adjudication or government cancellation rule is represented.`;
}
function cleanError(error) { return error.reason || error.info?.error?.data?.reason || error.shortMessage || error.message || 'Action failed'; }

async function createApplication(options = {}) {
  const directory = options.directory || path.join(__dirname, '../data');
  const store = openStore(directory);
  let networks;
  try { networks = await openNetworks(store, options); } catch (error) { store.close(); throw error; }
  const { customer, agent } = networks;
  const events = new EventEmitter();
  const getUser = userId => store.get('SELECT * FROM users WHERE id=?', userId);
  const byAddress = address => store.get('SELECT * FROM users WHERE address=? COLLATE NOCASE', address);
  const signer = (user, chain) => new Wallet(store.decrypt(user.private_key), networks[chain].provider);
  let stopped = false, timer, working = null;
  const faults = { relayPaused: false }; // Only exposed to local tests, never an HTTP control.

  async function addUser({ username, password, role, name, email, phone }) {
    const encodedPassword = await hashPassword(password);
    const wallet = Wallet.createRandom();
    const result = store.run('INSERT INTO users(username,password,role,name,email,phone,address,private_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      username, encodedPassword, role, name, email, phone, wallet.address, store.encrypt(wallet.privateKey), Date.now());
    return getUser(Number(result.lastInsertRowid));
  }
  if (!store.meta('ready')) {
    const password = options.adminPassword || `Admin-${uuid().slice(0, 16)}!`;
    await addUser({ username: 'admin', password, role: 'admin', name: 'Sahana Life Administrator',
      email: 'support@sahana.example', phone: '+91 80000 00000' });
    fs.writeFileSync(path.join(directory, 'INITIAL_ADMIN.txt'), `Administrator login\nUsername: admin\nPassword: ${password}\nLocal academic system only. Do not publish this file.\n`, { mode: 0o600 });
    store.meta('ready', 'yes');
  }

  async function employment(user) {
    if (user.role !== 'agent') return null;
    const value = await agent.contract.agents(user.address);
    const recordedStatus = ['pending', 'employed', 'resigned', 'rejected'][Number(value.status)];
    // Revocation takes effect directly from the authoritative agent chain.
    // New privileges wait until the positive employment mirror is confirmed.
    const synchronising = recordedStatus === 'employed' && !await customer.contract.employed(user.address);
    return { status: synchronising ? 'pending' : recordedStatus, recordedStatus, synchronising, changedAt: Number(value.changedAt) };
  }
  async function profile(user) {
    return { id: user.id, username: user.username, role: user.role, name: user.name, email: user.email,
      phone: user.phone, address: user.address, employment: await employment(user) };
  }
  function enqueue(user, kind, input, requestKey) {
    const existing = store.get('SELECT * FROM operations WHERE user_id=? AND request_key=?', user.id, requestKey);
    if (existing) {
      if (existing.kind !== kind || existing.input !== JSON.stringify(input)) throw new Error('This request key already belongs to a different action.');
      return existing.id;
    }
    const operationId = uuid();
    store.run('INSERT INTO operations(id,user_id,kind,input,state,request_key,created_at) VALUES(?,?,?,?,?,?,?)',
      operationId, user.id, kind, JSON.stringify(input), 'pending', requestKey, Date.now());
    kick();
    return operationId;
  }
  async function awaitReceipt(network, hash) {
    for (let count = 0; count < 600 && !stopped; count++) {
      const receipt = await network.provider.getTransactionReceipt(hash);
      if (receipt) { if (receipt.status !== 1) throw new Error('Transaction reverted. No contract state was changed.'); return receipt; }
      await pause(100);
    }
    throw new Error('Confirmation timed out. The recorded transaction will be checked before any retry.');
  }
  async function submit(network, wallet, request, table, key) {
    const isOperation = table === 'operations', keyColumn = isOperation ? 'id' : 'event_key';
    const hashColumn = isOperation ? 'source_tx' : 'tx_hash';
    let row = store.get(`SELECT * FROM ${table} WHERE ${keyColumn}=?`, key);
    if (!row.raw_tx) {
      const populated = await wallet.populateTransaction(request);
      const raw = await wallet.signTransaction(populated), hash = keccak256(raw);
      store.run(`UPDATE ${table} SET raw_tx=?,${hashColumn}=? WHERE ${keyColumn}=?`, raw, hash, key);
      row = store.get(`SELECT * FROM ${table} WHERE ${keyColumn}=?`, key);
    }
    const hash = row[hashColumn];
    const existingReceipt = await network.provider.getTransactionReceipt(hash);
    if (existingReceipt) { if (existingReceipt.status !== 1) throw new Error('Transaction reverted.'); return existingReceipt; }
    try { await network.provider.broadcastTransaction(row.raw_tx); }
    catch (error) { if (!await network.provider.getTransaction(hash)) throw error; }
    return awaitReceipt(network, hash);
  }
  async function fundGas(user, chain) {
    // Local-only gas allowance, independent of the INR business ledger.
    if (await networks[chain].provider.getBalance(user.address) === 0n) {
      await networks[chain].rpc.request({ method: 'evm_setAccountBalance', params: [user.address, `0x${parseEther('10').toString(16)}`] });
    }
  }
  async function processOperation(operation) {
    const user = getUser(operation.user_id), input = JSON.parse(operation.input), opKey = id(operation.id);
    const chain = ['approve', 'reject', 'resign'].includes(operation.kind) ? 'agent' : 'customer';
    const network = networks[chain];
    store.run('UPDATE operations SET source_chain=? WHERE id=?', chain, operation.id);
    let connected, request;
    if (operation.raw_tx) {
      // The exact signed transaction is durably saved before broadcast.
      await submit(network, signer(user, chain), null, 'operations', operation.id);
    } else {
      const adminAction = ['register', 'approve', 'reject'].includes(operation.kind);
      const wallet = adminAction ? network.administrator : signer(user, chain);
      await fundGas(user, chain);
      connected = network.contract.connect(wallet);
      if (operation.kind === 'register') request = await connected.registerCustomer.populateTransaction(user.address, opKey);
      if (['approve', 'reject'].includes(operation.kind)) {
        const applicant = getUser(input.agentId);
        request = await connected.decideAgent.populateTransaction(applicant.address, applicant.id, operation.kind === 'approve', opKey);
      }
      if (operation.kind === 'resign') request = await connected.resign.populateTransaction(opKey);
      if (operation.kind === 'purchase') {
        const plan = PLANS.find(plan => plan.id === input.planId);
        const assigned = await agent.contract.suggestAgent(user.address);
        if (assigned === ZeroAddress) throw new Error('No employed agent is available. Please try after an agent is approved.');
        if (!await customer.contract.employed(assigned)) throw new Error('Agent approval is still synchronising. Try again shortly.');
        const reference = `PG-${operation.id.slice(0, 8).toUpperCase()}`, policyId = id(reference);
        const text = terms(reference, plan), hash = sha256(toUtf8Bytes(text));
        store.run('INSERT OR IGNORE INTO documents VALUES(?,?,?,?,?)', policyId, reference, user.id, text, hash);
        request = await connected.purchase.populateTransaction(policyId, plan.id, assigned, hash, opKey);
      }
      if (operation.kind === 'pay') request = await connected.payPremium.populateTransaction(input.policyId, input.instalment, opKey);
      if (operation.kind === 'cancel') request = await connected.cancel.populateTransaction(input.policyId, input.termsHash, input.paid, input.fee, opKey);
      if (operation.kind === 'claim') request = await connected.claim.populateTransaction(input.policyId, opKey);
      if (!request) throw new Error('Unknown operation');
      await submit(network, wallet, request, 'operations', operation.id);
    }
    store.run("UPDATE operations SET state='synchronising',error=NULL WHERE id=?", operation.id);
    if (['approve', 'reject', 'resign'].includes(operation.kind)) {
      const changed = operation.kind === 'resign' ? user : getUser(input.agentId);
      events.emit('employment', { userId: changed.id });
    }
  }
  function notify(user, eventKey, kind, message, policyId = null) {
    if (!user) return;
    store.run('INSERT OR IGNORE INTO notifications(user_id,event_key,kind,message,policy_id,created_at) VALUES(?,?,?,?,?,?)', user.id, eventKey, kind, message, policyId, Date.now());
  }
  async function notifyEvent(event) {
    const args = JSON.parse(event.args), owner = byAddress(args.holder || args.customer || ZeroAddress);
    const admins = store.all("SELECT * FROM users WHERE role='admin'");
    if (event.name === 'EmploymentChanged') {
      const actor = byAddress(args.agent);
      if (Number(args.status) !== 1 && actor) store.run("DELETE FROM notifications WHERE user_id=? AND kind<>'employment'", actor.id);
      notify(actor, event.event_key, 'employment', `Employment status: ${['pending', 'employed', 'resigned', 'rejected'][Number(args.status)]}.`);
    }
    if (event.name === 'AssignmentChanged') {
      const current = byAddress(args.currentAgent);
      notify(owner, event.event_key, 'assignment', current ? `Your current servicing agent is ${current.name}. Your policy terms have not changed.` : 'Awaiting reassignment. Contact Sahana Life support; your policy terms are unchanged.');
      notify(current, event.event_key, 'assignment', 'A customer portfolio has been assigned to you.');
      if (!current) for (const admin of admins) notify(admin, event.event_key, 'assignment', 'A customer is awaiting an employed servicing agent.');
    }
    if (['PolicyPurchased', 'PremiumPaid', 'PolicyClosed'].includes(event.name)) {
      const document = store.get('SELECT reference FROM documents WHERE policy_id=?', args.policyId);
      const reference = document?.reference || 'Policy';
      let message = `${reference}: policy issued.`;
      if (event.name === 'PremiumPaid') message = `${reference}: premium ${args.instalment} recorded, INR ${Number(args.amount) / 100}.`;
      if (event.name === 'PolicyClosed') message = Number(args.status) === 1 ? `${reference}: cancelled. Fee INR ${Number(args.fee) / 100}; refund INR ${Number(args.refund) / 100}; bonus forfeited.` : `${reference}: maturity settled, INR ${Number(args.refund) / 100}.`;
      notify(owner, event.event_key, 'policy', message, args.policyId);
      const assignment = await agent.contract.assignments(args.holder);
      const current = byAddress(assignment);
      if (current && (await employment(current)).status === 'employed') notify(current, event.event_key, 'policy', message, args.policyId);
    }
  }
  async function scan(chain) {
    const network = networks[chain];
    const cursor = Number(store.meta(`cursor-${chain}`) || -1);
    const head = await network.provider.getBlockNumber();
    if (head < cursor) throw new Error('Blockchain history moved backwards. Restore consistent storage.');
    if (head === cursor) return 0;
    const logs = await network.contract.queryFilter('*', cursor + 1, head);
    let created = 0;
    store.db.exec('BEGIN');
    try {
      for (const log of logs) {
        const decoded = network.contract.interface.parseLog(log);
        const args = Object.fromEntries(decoded.fragment.inputs.map((input, index) => [input.name, decoded.args[index]]));
        const key = id(`${network.chainId}:${await network.contract.getAddress()}:${log.transactionHash}:${log.index}`);
        const origin = store.get('SELECT id FROM operations WHERE source_tx=?', log.transactionHash)?.id ||
          store.get('SELECT e.operation_id FROM relay_jobs j JOIN events e USING(event_key) WHERE j.tx_hash=?', log.transactionHash)?.operation_id || null;
        store.run('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?)', key, chain, log.blockNumber, log.transactionHash, log.index, decoded.name, asJSON(args), origin);
        const forward = chain === 'customer' ? ['PolicyPurchased', 'PremiumPaid', 'PolicyClosed'].includes(decoded.name) : ['EmploymentChanged', 'AssignmentChanged'].includes(decoded.name);
        if (forward) {
          store.run("INSERT OR IGNORE INTO relay_jobs(event_key,destination,state) VALUES(?,?,'pending')", key, chain === 'customer' ? 'agent' : 'customer'); created++;
        }
      }
      store.meta(`cursor-${chain}`, String(head)); store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    return created;
  }
  async function deliver(job) {
    const event = store.get('SELECT * FROM events WHERE event_key=?', job.event_key), args = JSON.parse(event.args);
    const network = networks[job.destination], connected = network.contract.connect(network.relay);
    let request;
    if (!job.raw_tx && !await connected.applied(job.event_key)) {
      if (event.name === 'EmploymentChanged') request = await connected.mirrorEmployment.populateTransaction(job.event_key, args.agent, Number(args.status) === 1);
      if (event.name === 'AssignmentChanged') request = await connected.mirrorAssignment.populateTransaction(job.event_key, args.customer, args.currentAgent);
      if (event.name === 'PolicyPurchased') request = await connected.mirrorPurchase.populateTransaction(job.event_key, args.policyId, args.holder, args.onboardingAgent, args.plan, args.annualPremium, args.yearsCount, args.bonus, args.issuedAt);
      if (event.name === 'PremiumPaid') request = await connected.mirrorPayment.populateTransaction(job.event_key, args.policyId, args.totalPaid);
      if (event.name === 'PolicyClosed') request = await connected.mirrorClose.populateTransaction(job.event_key, args.policyId, args.status, args.fee, args.refund);
    }
    if (request || job.raw_tx) await submit(network, network.relay, request, 'relay_jobs', job.event_key);
    // Notification inserts are idempotent. Complete only after notifications succeed.
    await notifyEvent(event);
    store.run("UPDATE relay_jobs SET state='synchronised',error=NULL WHERE event_key=?", job.event_key);
  }
  async function sync() {
    for (let round = 0; round < 8; round++) {
      await scan('customer'); await scan('agent');
      const jobs = store.all("SELECT j.* FROM relay_jobs j JOIN events e USING(event_key) WHERE j.state<>'synchronised' ORDER BY e.chain,e.block_number,e.log_index");
      if (!jobs.length || faults.relayPaused) break;
      let failed = false;
      for (const job of jobs) {
        try { await deliver(job); }
        catch (error) {
          store.run("UPDATE relay_jobs SET state='needs_attention',attempts=attempts+1,error=? WHERE event_key=?", cleanError(error), job.event_key);
          failed = true; break; // Preserve ordered delivery on subsequent retries.
        }
      }
      if (failed) break;
    }
    await scan('customer'); await scan('agent');
    for (const operation of store.all("SELECT * FROM operations WHERE source_tx IS NOT NULL AND state IN ('synchronising','needs_attention')")) {
      const receipt = await networks[operation.source_chain].provider.getTransactionReceipt(operation.source_tx);
      if (!receipt || receipt.status !== 1) continue;
      const pending = store.get("SELECT COUNT(*) n FROM relay_jobs j JOIN events e USING(event_key) WHERE e.operation_id=? AND j.state<>'synchronised'", operation.id).n;
      const failed = store.get("SELECT COUNT(*) n FROM relay_jobs j JOIN events e USING(event_key) WHERE e.operation_id=? AND j.state='needs_attention'", operation.id).n;
      store.run('UPDATE operations SET state=?,error=? WHERE id=?', failed ? 'needs_attention' : pending ? 'synchronising' : 'synchronised', failed ? 'A cross-chain update needs attention; the confirmed source transaction is retained.' : null, operation.id);
    }
  }
  async function cycle() {
    await sync();
    // A stop or lost RPC response may leave an already signed source transaction
    // unconfirmed. Resume that exact transaction; never construct a second debit.
    for (const operation of store.all("SELECT * FROM operations WHERE state='needs_attention' AND raw_tx IS NOT NULL")) {
      const receipt = await networks[operation.source_chain].provider.getTransactionReceipt(operation.source_tx);
      if (!receipt) store.run("UPDATE operations SET state='pending',error=NULL WHERE id=?", operation.id);
    }
    const operations = store.all("SELECT * FROM operations WHERE state='pending' ORDER BY created_at,id");
    for (const operation of operations) {
      if (stopped) break;
      try { await processOperation(operation); }
      catch (error) { store.run("UPDATE operations SET state='needs_attention',error=? WHERE id=?", cleanError(error), operation.id); }
      await sync();
    }
  }
  function kick() {
    if (working || stopped) return working;
    working = cycle().then(() => store.meta('workerError', '')).catch(error => { store.meta('workerError', cleanError(error)); }).finally(() => { working = null; });
    return working;
  }
  if (options.autoStart !== false) { timer = setInterval(kick, 1500); timer.unref(); kick(); }
  async function drain() { if (working) await working; await kick(); }
  async function policyDetails(policyId, viewer) {
    const policy = await customer.contract.getPolicy(policyId);
    const assigned = await agent.contract.assignments(policy.holder);
    if (viewer.role === 'customer' && policy.holder.toLowerCase() !== viewer.address.toLowerCase()) throw new Error('Policy not found');
    if (viewer.role === 'agent' && ((await employment(viewer)).status !== 'employed' || assigned.toLowerCase() !== viewer.address.toLowerCase())) throw new Error('Policy not found');
    const current = byAddress(assigned), original = byAddress(policy.onboardingAgent), holder = byAddress(policy.holder);
    const document = store.get('SELECT * FROM documents WHERE policy_id=?', policyId);
    const chainTime = Number((await customer.provider.getBlock('latest')).timestamp);
    const data = { policyId, reference: document?.reference || policyId, plan: Number(policy.plan),
      premium: Number(policy.annualPremium), years: Number(policy.yearsCount), bonus: Number(policy.bonus),
      issuedAt: Number(policy.issuedAt), maturityAt: Number(policy.issuedAt) + Number(policy.yearsCount) * YEAR,
      paidCount: Number(policy.instalmentsPaid), paid: Number(policy.instalmentsPaid * policy.annualPremium),
      status: ['active', 'cancelled', 'settled'][Number(policy.status)], fee: Number(policy.fee), returnedAmount: Number(policy.returnedAmount),
      termsHash: policy.termsHash, terms: document?.text || null, chainTime,
      originalAgent: original ? await profile(original) : null,
      currentAgent: current && (await employment(current)).status === 'employed' ? await profile(current) : null,
      holder: holder ? { id: holder.id, name: holder.name, email: holder.email, phone: holder.phone, username: holder.username } : null };
    data.canClaim = data.status === 'active' && chainTime >= data.maturityAt && data.paidCount === data.years;
    data.canCancel = data.status === 'active' && chainTime < data.maturityAt;
    data.events = store.all('SELECT chain,tx_hash,name,args,block_number,log_index,event_key FROM events WHERE name IN (\'PolicyPurchased\',\'PremiumPaid\',\'PolicyClosed\',\'AssignmentChanged\') ORDER BY block_number,log_index')
      .filter(event => { const args = JSON.parse(event.args); return args.policyId === policyId || args.customer?.toLowerCase() === policy.holder.toLowerCase(); })
      .map(event => ({ ...event, args: JSON.parse(event.args), relay: store.get('SELECT destination,state,tx_hash,error FROM relay_jobs WHERE event_key=?', event.event_key) || null }));
    await Promise.all(data.events.map(async event => { event.timestamp = Number((await networks[event.chain].provider.getBlock(event.block_number)).timestamp); }));
    data.events.sort((a, b) => a.timestamp - b.timestamp || a.chain.localeCompare(b.chain) || a.block_number - b.block_number || a.log_index - b.log_index);
    return data;
  }
  async function listPolicies(viewer) {
    if (viewer.role === 'agent' && (await employment(viewer)).status !== 'employed') throw new Error('Customer access has been removed.');
    const events = store.all("SELECT args FROM events WHERE chain='customer' AND name='PolicyPurchased' ORDER BY block_number DESC");
    const result = [];
    for (const event of events) {
      const args = JSON.parse(event.args);
      if (viewer.role === 'customer' && args.holder.toLowerCase() !== viewer.address.toLowerCase()) continue;
      if (viewer.role === 'agent' && (await agent.contract.assignments(args.holder)).toLowerCase() !== viewer.address.toLowerCase()) continue;
      result.push(await policyDetails(args.policyId, viewer));
    }
    return result;
  }
  return { store, networks, events, faults, getUser, byAddress, signer, profile, employment, addUser, enqueue, drain, sync, policyDetails, listPolicies,
    async close() { stopped = true; clearInterval(timer); if (working) await working; await networks.close(); store.close(); } };
}
module.exports = { createApplication, PLANS, YEAR, terms, cleanError };
