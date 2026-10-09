const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = () => crypto.randomUUID();
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
async function checkPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = (await hashPassword(password, salt)).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
function openStore(directory) {
  const exists = fs.existsSync(directory);
  if (exists && (!fs.existsSync(path.join(directory, 'app.sqlite')) || !fs.existsSync(path.join(directory, 'secret.key')))) {
    throw new Error('Incomplete application storage. Restore the complete data directory from a backup; automatic replacement is disabled.');
  }
  fs.mkdirSync(directory, { recursive: true });
  const secretPath = path.join(directory, 'secret.key');
  if (!exists) fs.writeFileSync(secretPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  const secret = fs.readFileSync(secretPath);
  if (secret.length !== 32) throw new Error('Invalid signing-key encryption secret. Restore the original secret.key.');
  const db = new DatabaseSync(path.join(directory, 'app.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,
      role TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT UNIQUE NOT NULL,
      private_key TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
      input TEXT NOT NULL,state TEXT NOT NULL,source_chain TEXT,source_tx TEXT,raw_tx TEXT,error TEXT,
      request_key TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS events(event_key TEXT PRIMARY KEY,chain TEXT NOT NULL,block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,log_index INTEGER NOT NULL,name TEXT NOT NULL,args TEXT NOT NULL,operation_id TEXT);
    CREATE TABLE IF NOT EXISTS relay_jobs(event_key TEXT PRIMARY KEY REFERENCES events(event_key),destination TEXT NOT NULL,
      state TEXT NOT NULL,tx_hash TEXT,raw_tx TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
      event_key TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,policy_id TEXT,read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,UNIQUE(user_id,event_key,kind));
    CREATE TABLE IF NOT EXISTS documents(policy_id TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL,
      text TEXT NOT NULL,terms_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_time INTEGER NOT NULL);
  `);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const meta = (key, value) => value === undefined ? get('SELECT value FROM meta WHERE key=?', key)?.value : run('INSERT OR REPLACE INTO meta VALUES(?,?)', key, value);
  function encrypt(text) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.');
  }
  function decrypt(text) {
    const [iv, tag, data] = text.split('.').map(part => Buffer.from(part, 'base64'));
    const cipher = crypto.createDecipheriv('aes-256-gcm', secret, iv); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  }
  return { db, run, get, all, meta, encrypt, decrypt, directory, fresh: !exists, close: () => db.close() };
}
module.exports = { openStore, hashPassword, checkPassword, digest, uuid };
