require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const auth = require('./auth');

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
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14, sameSite: 'lax' },
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

app.post('/api/auth/setup', (req, res) => {
  if (auth.hasUser()) return res.status(400).json({ error: 'Utente gia\' configurato' });
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username obbligatorio e password di almeno 8 caratteri' });
  }
  auth.createUser(username, password);
  req.session.userId = username;
  res.status(201).json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!auth.verifyUser(username, password)) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  req.session.userId = username;
  res.json({ ok: true });
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

// --- Frontend statico ---
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
