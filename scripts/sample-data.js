const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApplication } = require('../lib/application');

async function setupSamples(directory = process.env.POLICYGUARD_DATA || path.join(__dirname, '../data')) {
  const app = await createApplication({ directory, autoStart: false });
  try {
    if (app.store.meta('samples') === 'complete') {
      console.log('Sample setup is already complete. Existing accounts, passwords and policies were kept.');
      return { created: false };
    }
    if (app.store.get("SELECT COUNT(*) n FROM users WHERE role<>'admin'").n) {
      throw new Error('Sample setup only runs in an application with no customer or agent accounts. Existing data was kept. Use the normal sign-up screens instead.');
    }
    const password = `Sample-${crypto.randomBytes(8).toString('hex')}!`;
    const credentialPath = path.join(directory, 'SAMPLE_ACCOUNTS.txt');
    fs.writeFileSync(credentialPath, `PolicyGuard fictional sample accounts\n\nCustomer portal\n  Username: sample_krishnan (Growth + Assurance)\n  Username: sample_meera (Long-Term)\n\nAgent portal\n  Username: sample_ananya (Krishnan's original agent)\n  Username: sample_vikram (Meera's original agent)\n\nPassword for all four sample accounts: ${password}\n\nAdministrator credentials: INITIAL_ADMIN.txt in the same folder.\nThese are fictional people and non-withdrawable test funds.\nDo not publish this file or the data directory.\n`, { flag: 'wx', mode: 0o600 });
    const admin = app.store.get("SELECT * FROM users WHERE role='admin'");
    async function action(user, kind, input, key) {
      const operationId = app.enqueue(user, kind, input, key);
      await app.drain();
      const operation = app.store.get('SELECT * FROM operations WHERE id=?', operationId);
      if (operation.state !== 'synchronised') throw new Error(`Sample action ${kind} needs attention: ${operation.error || operation.state}`);
    }
    async function account(username, role, name, phone) {
      return app.addUser({ username, role, name, phone, email: `${username}@sahana.example`, password });
    }
    const ananya = await account('sample_ananya', 'agent', 'Ananya Rao', '+91 80000 00001');
    const vikram = await account('sample_vikram', 'agent', 'Vikram Shah', '+91 80000 00002');
    await action(admin, 'approve', { agentId: ananya.id }, 'sample-approve-ananya');
    await action(admin, 'approve', { agentId: vikram.id }, 'sample-approve-vikram');
    const krishnan = await account('sample_krishnan', 'customer', 'R. Krishnan', '+91 80000 00003');
    const meera = await account('sample_meera', 'customer', 'Meera Raman', '+91 80000 00004');
    for (const customer of [krishnan, meera]) await action(customer, 'register', {}, 'signup-credit');
    await action(krishnan, 'purchase', { planId: 2 }, 'sample-growth');
    await action(meera, 'purchase', { planId: 3 }, 'sample-long-term');
    await action(krishnan, 'purchase', { planId: 1 }, 'sample-assurance');
    app.store.meta('samples', 'complete');
    console.log(`Sample setup complete: two employed agents, two customers and three policies.\nPrivate login details: ${credentialPath}\nRun START_POLICYGUARD.cmd to open the application.`);
    return { created: true };
  } finally { await app.close(); }
}
if (require.main === module) setupSamples().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { setupSamples };
