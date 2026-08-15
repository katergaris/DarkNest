const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Se SESSION_SECRET/ENCRYPTION_KEY non arrivano da .env o dall'ambiente (es.
// un "docker compose up" senza alcun file preparato prima, come nell'installazione
// da GUI di CasaOS), li generiamo qui e li salviamo dentro data/ — lo stesso
// volume gia' usato per il database, quindi sopravvivono a riavvii e rebuild
// esattamente come i dati che proteggono.
const DATA_DIR = path.join(__dirname, '..', 'data');
const SECRETS_FILE = path.join(DATA_DIR, '.secrets.env');

const PLACEHOLDER_VALUES = [
  'cambiami-con-una-stringa-lunga-e-casuale',
  'cambiami-con-una-passphrase-lunga-e-segreta',
];

function needsValue(name) {
  const v = process.env[name];
  return !v || PLACEHOLDER_VALUES.includes(v);
}

function loadPersisted() {
  if (!fs.existsSync(SECRETS_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(SECRETS_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function ensureSecrets() {
  if (!needsValue('SESSION_SECRET') && !needsValue('ENCRYPTION_KEY')) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const persisted = loadPersisted();
  let changed = false;

  for (const name of ['SESSION_SECRET', 'ENCRYPTION_KEY']) {
    if (!needsValue(name)) continue; // arriva gia' da .env/ambiente: quella vince sempre
    if (persisted[name]) {
      process.env[name] = persisted[name]; // riavvio: riusa quanto generato la prima volta
      continue;
    }
    process.env[name] = crypto.randomBytes(32).toString('hex');
    persisted[name] = process.env[name];
    changed = true;
  }

  if (changed) {
    const body = Object.entries(persisted).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(SECRETS_FILE, body, { mode: 0o600 });
    console.log(
      '✓ SESSION_SECRET/ENCRYPTION_KEY generati automaticamente e salvati in data/.secrets.env ' +
      '(non cancellare la cartella "data": senza quel file le password nel vault non sono piu\' recuperabili)'
    );
  }
}

module.exports = { ensureSecrets, SECRETS_FILE };
