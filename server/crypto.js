const crypto = require('crypto');

const RAW_KEY = process.env.ENCRYPTION_KEY;
if (!RAW_KEY || RAW_KEY.length < 8) {
  console.error(
    'ENCRYPTION_KEY mancante o troppo corta. Impostala nel file .env prima di avviare Mindkeep.'
  );
  process.exit(1);
}

// Sale fisso derivato dalla stessa passphrase: va bene perche' la chiave finale
// dipende comunque da ENCRYPTION_KEY, che l'utente tiene segreta e non versiona.
// NON cambiare questa stringa (nemmeno per il rebranding): e' parte della
// derivazione della chiave di cifratura del vault. Cambiarla rende illeggibile
// per sempre ogni voce del vault gia' salvata con la versione precedente.
const SALT = crypto.createHash('sha256').update('darknest-vault-salt').digest();
const KEY = crypto.scryptSync(RAW_KEY, SALT, 32);

function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
