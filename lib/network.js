const fs = require('node:fs');
const path = require('node:path');
process.env.UWS_USE_FALLBACK = 'true';
const ganache = require('ganache');
const solc = require('solc');
const { Wallet, BrowserProvider, Contract, ContractFactory, keccak256, toUtf8Bytes, parseEther } = require('ethers');
const { digest } = require('./storage');
let artifacts;
function compile() {
  if (artifacts) return artifacts;
  const sources = Object.fromEntries(['CustomerLedger', 'AgentLedger'].map(name => [`${name}.sol`, {
    content: fs.readFileSync(path.join(__dirname, '../contracts', `${name}.sol`), 'utf8')
  }]));
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  artifacts = { fingerprint: digest(JSON.stringify(sources)), compiler: solc.version() };
  for (const name of ['CustomerLedger', 'AgentLedger']) {
    const contract = output.contracts[`${name}.sol`][name];
    artifacts[name] = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
  }
  return artifacts;
}
async function openNetworks(store, { blockTime = 2 } = {}) {
  const compiled = compile();
  let config;
  const saved = store.meta('networks');
  if (saved) {
    config = JSON.parse(saved);
    if (store.meta('ready') !== 'yes') throw new Error('Interrupted first-time setup. Restore a complete backup or move the incomplete data folder aside explicitly.');
    if (config.fingerprint !== compiled.fingerprint) throw new Error('Contract source differs from this persisted deployment. Restore matching source or use a separate data directory.');
    for (const name of ['customer', 'agent']) {
      if (!fs.existsSync(path.join(store.directory, `chain-${name}`, 'CURRENT'))) throw new Error(`Missing ${name} chain database. Restore the complete data directory; refusing to reset history.`);
    }
  } else {
    if (!store.fresh) throw new Error('Missing chain configuration in existing storage. Recovery is required.');
    config = { fingerprint: compiled.fingerprint, adminKey: store.encrypt(Wallet.createRandom().privateKey),
      relayKey: store.encrypt(Wallet.createRandom().privateKey) };
    store.meta('networks', JSON.stringify(config));
  }
  const networks = {};
  try {
    for (const [name, chainId, contractName] of [['customer', 1337, 'CustomerLedger'], ['agent', 1338, 'AgentLedger']]) {
      const privateKeys = [store.decrypt(config.adminKey), store.decrypt(config.relayKey)];
      const rpc = ganache.provider({ logging: { quiet: true },
        database: { dbPath: path.join(store.directory, `chain-${name}`) },
        wallet: { accounts: privateKeys.map(secretKey => ({ secretKey, balance: `0x${parseEther('1000000').toString(16)}` })) },
        chain: { chainId, networkId: chainId, hardfork: 'shanghai' }, miner: { blockTime } });
      const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 100;
      const administrator = new Wallet(privateKeys[0], provider), relay = new Wallet(privateKeys[1], provider);
      const network = { name, chainId, rpc, provider, administrator, relay, artifact: compiled[contractName] };
      networks[name] = network;
      if (saved) {
        const genesis = await provider.getBlock(0);
        if (genesis.hash !== config[name].genesis || await provider.getCode(config[name].address) === '0x') {
          throw new Error(`${name} deployment does not match saved history. Restore a consistent backup.`);
        }
        network.contract = new Contract(config[name].address, compiled[contractName].abi, administrator);
      } else {
        network.contract = await new ContractFactory(compiled[contractName].abi, compiled[contractName].bytecode, administrator).deploy(relay.address);
        await network.contract.waitForDeployment();
        config[name] = { address: await network.contract.getAddress(), genesis: (await provider.getBlock(0)).hash };
        store.meta('networks', JSON.stringify(config));
      }
    }
    return { ...networks, config, compiler: compiled.compiler, async close() {
      for (const network of Object.values(networks)) { network.provider.destroy(); await network.rpc.disconnect(); }
    } };
  } catch (error) {
    for (const network of Object.values(networks)) { network.provider.destroy(); await network.rpc.disconnect().catch(() => {}); }
    throw error;
  }
}
// No invented block data: checks use the actual RPC block and receipt fields.
function checkLinks(blocks, receipts) {
  const issues = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i], number = Number(BigInt(block.number));
    if (i && (number !== Number(BigInt(blocks[i - 1].number)) + 1 || block.parentHash !== blocks[i - 1].hash)) issues.push(`Broken parent link at block ${number}`);
    if (i && BigInt(block.timestamp) < BigInt(blocks[i - 1].timestamp)) issues.push(`Timestamp moved backwards at block ${number}`);
    (block.transactions || []).forEach((transaction, index) => {
      const hash = typeof transaction === 'string' ? transaction : transaction.hash;
      const receipt = receipts[hash];
      if (!receipt || receipt.blockHash !== block.hash || Number(BigInt(receipt.blockNumber)) !== number || Number(BigInt(receipt.transactionIndex)) !== index || receipt.transactionHash !== hash) issues.push(`Receipt membership mismatch: ${hash}`);
    });
  }
  return { valid: !issues.length, issues, blocksChecked: blocks.length,
    description: 'Parent links, ordering and receipt membership checked against local RPC data. This is not independent consensus validation.' };
}
module.exports = { openNetworks, compile, checkLinks };
