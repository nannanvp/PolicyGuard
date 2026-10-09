const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('../app-server');
const { launch, health, freePort } = require('../scripts/launch-local');

test('desktop launcher identifies and reuses the same installation without exposing profiles or keys', async () => {
  const directory = path.join(os.tmpdir(), `policyguard-launch-${crypto.randomUUID()}`, 'data');
  const instance = await createServer({ directory, blockTime: 0, autoStart: false });
  let port = 42100;
  while (!await freePort(port)) port++;
  await new Promise(resolve => instance.server.listen(port, '127.0.0.1', resolve));
  const previous = { port: process.env.PORT, data: process.env.POLICYGUARD_DATA, browser: process.env.POLICYGUARD_NO_BROWSER };
  try {
    const result = await health(port);
    assert.equal(result.application, 'PolicyGuard');
    assert.deepEqual(Object.keys(result).sort(), ['application', 'instance', 'version']);
    assert.equal(result.instance, crypto.createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 16));
    assert.equal(await freePort(port), false);
    process.env.PORT = String(port); process.env.POLICYGUARD_DATA = directory; process.env.POLICYGUARD_NO_BROWSER = '1';
    assert.equal(await launch(), undefined);
    assert.equal(instance.server.listening, true);
    assert.ok(fs.existsSync(path.join(directory, 'INITIAL_ADMIN.txt')));
  } finally {
    for (const [name, value] of [['PORT', previous.port], ['POLICYGUARD_DATA', previous.data], ['POLICYGUARD_NO_BROWSER', previous.browser]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await instance.close();
  }
});
