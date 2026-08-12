const crypto = require('crypto');

// Implementazione di TOTP (RFC 6238), lo standard usato da Google
// Authenticator, Aegis, 1Password, Authy e simili. Non serve nessun servizio
// esterno: il telefono e il server calcolano lo stesso codice partendo dal
// segreto condiviso e dall'ora corrente.

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Segreto non valido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20 byte casuali = 160 bit, la lunghezza raccomandata dalla RFC 4226.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function counterBuffer(counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  return buf;
}

function codeForStep(secret, step, digits = DIGITS) {
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer(step)).digest();
  // "Dynamic truncation": gli ultimi 4 bit indicano da dove leggere il numero.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/**
 * Verifica un codice a 6 cifre.
 * `window` copre l'orologio del telefono leggermente sfasato rispetto al
 * server (1 = +/- 30 secondi). Restituisce lo "step" usato, cosi' chi chiama
 * puo' impedire che lo stesso codice venga riutilizzato finche' e' valido.
 */
function verify(secret, token, { window = 1, now = Date.now() } = {}) {
  const clean = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const center = currentStep(now);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = center + offset;
    const expected = codeForStep(secret, step);
    // Confronto a tempo costante: evita di far trapelare quante cifre sono corrette.
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

// URI standard che le app di autenticazione leggono dal QR.
function otpauthUrl(secret, { account = 'DarkNest', issuer = 'DarkNest' } = {}) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Segreto raggruppato a blocchi di 4, per chi preferisce digitarlo a mano.
function formatSecret(secret) {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

module.exports = { generateSecret, verify, otpauthUrl, formatSecret, codeForStep, currentStep, base32Decode };
