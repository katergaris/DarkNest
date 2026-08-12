require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const auth = require('./auth');
const SqliteStore = require('./session-store');

const app = express();
const PORT = process.env.PORT || 3000;

const PLACEHOLDER_VALUES = [
  'cambiami-con-una-stringa-lunga-e-casuale',
  'cambiami-con-una-passphrase-lunga-e-segreta',
];

if (!process.env.SESSION_SECRET || PLACEHOLDER_VALUES.includes(process.env.SESSION_SECRET)) {
  console.error(
    'SESSION_SECRET mancante o lasciata al valore di esempio. Esegui setup.sh (o setup.ps1 su Windows) oppure imposta un valore casuale nel file .env prima di avviare DarkNest.'
  );
  process.exit(1);
}
if (process.env.ENCRYPTION_KEY && PLACEHOLDER_VALUES.includes(process.env.ENCRYPTION_KEY)) {
  console.error(
    'ENCRYPTION_KEY lasciata al valore di esempio. Esegui setup.sh (o setup.ps1 su Windows) oppure imposta una passphrase casuale nel file .env prima di avviare DarkNest.'
  );
  process.exit(1);
}
// ENCRYPTION_KEY viene ulteriormente validata (presenza/lunghezza minima) da server/crypto.js al primo require

app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14, sameSite: 'lax', httpOnly: true },
  })
);

// --- Health check (pubblico, usato da Docker e dallo script di setup) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Autenticazione ---
app.get('/api/auth/status', (req, res) => {
  res.json({ setupNeeded: !auth.hasUser(), authenticated: !!(req.session && req.session.userId) });
});

// Rigenera l'id di sessione dopo l'autenticazione (evita il session fixation:
// un id ottenuto prima del login non deve restare valido dopo).
function startSession(req, res, username, status) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Impossibile creare la sessione' });
    req.session.userId = username;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Impossibile creare la sessione' });
      res.status(status).json({ ok: true });
    });
  });
}

app.post('/api/auth/setup', (req, res) => {
  if (auth.hasUser()) return res.status(400).json({ error: 'Utente gia\' configurato' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username obbligatorio e password di almeno 8 caratteri' });
  }
  auth.createUser(username, password);
  startSession(req, res, username, 201);
});

// Freno anti forza bruta: il vault e' protetto da una sola password, quindi
// dopo troppi tentativi falliti dallo stesso IP il login si blocca per un po'.
const MAX_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function attemptsFor(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() > entry.until) {
    loginAttempts.delete(ip);
    return null;
  }
  return entry;
}

// Evita che la mappa cresca all'infinito con IP che non tornano piu'.
function pruneAttempts() {
  if (loginAttempts.size < 1000) return;
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.until) loginAttempts.delete(ip);
  }
}

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const entry = attemptsFor(ip);
  if (entry && entry.count >= MAX_ATTEMPTS) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Troppi tentativi falliti. Riprova tra ${minutes} minuti.` });
  }

  const { username, password } = req.body || {};
  if (!auth.verifyUser(username, password)) {
    const count = (entry ? entry.count : 0) + 1;
    pruneAttempts();
    loginAttempts.set(ip, { count, until: Date.now() + LOCK_MS });
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  loginAttempts.delete(ip);
  startSession(req, res, username, 200);
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- Rotte protette ---
app.use('/api/ideas', auth.requireAuth, require('./routes/ideas'));
app.use('/api/projects', auth.requireAuth, require('./routes/projects'));
app.use('/api/vault', auth.requireAuth, require('./routes/vault'));
app.use('/api/accounts', auth.requireAuth, require('./routes/accounts'));
app.use('/api/drive', auth.requireAuth, require('./routes/drive'));
app.use('/api/dossiers', auth.requireAuth, require('./routes/dossiers'));
app.use('/api/search', auth.requireAuth, require('./routes/search'));
app.use('/api/trash', auth.requireAuth, require('./routes/trash'));
app.use('/api/backup', auth.requireAuth, require('./routes/backup'));

// Una rotta /api inesistente deve rispondere 404 JSON: senza questo finiva nel
// catch-all qui sotto e il client riceveva la index.html con status 200.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

// --- Frontend statico ---
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Gestore errori centrale: senza, multer (file troppo grande) o un JSON malformato
// producevano una pagina HTML di errore che il frontend non sa interpretare.
// La firma a 4 parametri e' quella che Express riconosce come error handler.
app.use((err, req, res, next) => {
  // Risposta gia' iniziata (es. download in corso): lasciamo che Express chiuda.
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File troppo grande' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Richiesta troppo grande' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corpo della richiesta non valido' });
  }
  console.error('Errore non gestito:', err);
  res.status(500).json({ error: 'Errore interno del server' });
});

const server = app.listen(PORT, () => {
  console.log(`DarkNest in ascolto su http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `La porta ${PORT} e' gia' in uso. Cambia PORT nel file .env (e la mappatura corrispondente in docker-compose.yml) oppure chiudi il processo che la occupa.`
    );
  } else {
    console.error('Errore di avvio del server:', err.message);
  }
  process.exit(1);
});
