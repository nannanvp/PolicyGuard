// Optional read-only portfolio / explorer check against the running sample installation.
// It signs in and reads data, but never submits policy, employment or financial actions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const directory = process.env.POLICYGUARD_DATA || path.join(__dirname, '../data');
  const credentials = fs.readFileSync(path.join(directory, 'SAMPLE_ACCOUNTS.txt'), 'utf8');
  const password = /Password for all four sample accounts: (.+)/.exec(credentials)?.[1];
  assert.ok(password, 'Sample credential file is required');
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PolicyGuard-Request': '1' }, body: JSON.stringify({ username: 'sample_krishnan', password, role: 'customer' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], account = await login.json();
  const get = async route => {
    const response = await fetch(`${base}/api${route}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200); return response.json();
  };
  const dashboard = await get('/customer/dashboard');
  assert.equal(dashboard.policies.length, 2);
  assert.deepEqual(dashboard.policies.map(p => p.plan).sort(), [1, 2]);
  const chains = [];
  for (const name of ['customer', 'agent']) {
    const list = await get(`/explorer/blocks?chain=${name}`);
    assert.equal(list.chainId, name === 'customer' ? 1337 : 1338);
    const timestamps = list.blocks.slice(0, 4).map(block => Number(BigInt(block.timestamp)));
    const intervals = timestamps.slice(0, -1).map((time, index) => time - timestamps[index + 1]);
    assert.ok(intervals.every(seconds => seconds >= 1 && seconds <= 3), 'Recent blocks follow the two-second development interval');
    assert.equal((await get(`/explorer/integrity?chain=${name}`)).valid, true);
    chains.push({ chain: name, chainId: list.chainId, head: list.head, recentBlockIntervalsSeconds: intervals, contract: list.contractAddress, linksValid: true });
  }
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-PolicyGuard-Request': '1', 'X-CSRF-Token': account.csrf }, body: '{}' });
  assert.equal(logout.status, 200);
  const report = { date: new Date().toISOString(), sampleCustomerPolicies: dashboard.policies.length, chains, financialOrEmploymentActionsSubmitted: 0 };
  fs.writeFileSync(path.join(__dirname, '../artifacts/v2/installation-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
