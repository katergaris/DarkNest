const test = require('node:test');
const assert = require('node:assert/strict');

// crypto.js legge ENCRYPTION_KEY al require: va impostata prima di importarlo.
process.env.ENCRYPTION_KEY = 'test-encryption-key-non-usare-in-produzione';
const { encrypt, decrypt } = require('./crypto');

test('encrypt/decrypt fanno un round-trip fedele', () => {
  const original = 'una password segreta';
  const encrypted = encrypt(original);
  assert.notEqual(encrypted, original);
  assert.equal(decrypt(encrypted), original);
});

test('cifrare due volte lo stesso valore da\' risultati diversi (IV casuale)', () => {
  const a = encrypt('stessa password');
  const b = encrypt('stessa password');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'stessa password');
  assert.equal(decrypt(b), 'stessa password');
});

test('un payload manomesso non si decifra (auth tag GCM)', () => {
  const encrypted = encrypt('dato integro');
  const buf = Buffer.from(encrypted, 'base64');
  buf[buf.length - 1] ^= 0xff; // altera l'ultimo byte del testo cifrato
  const tampered = buf.toString('base64');
  assert.throws(() => decrypt(tampered));
});

test('gestisce correttamente una stringa vuota', () => {
  assert.equal(decrypt(encrypt('')), '');
});

test('gestisce correttamente caratteri unicode', () => {
  const original = 'pàssword con emoji 🔐 e àccenti';
  assert.equal(decrypt(encrypt(original)), original);
});
