#!/usr/bin/env node
// Uscita di sicurezza: disattiva la verifica in due passaggi da riga di comando,
// per quando il telefono si perde e i codici di recupero non sono a portata.
//
//   docker compose exec darknest node server/disable-2fa.js
//
// Richiede l'accesso al server su cui gira DarkNest: chi puo' eseguire questo
// comando ha gia' accesso al database, quindi non indebolisce la protezione.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./db');

const users = db.prepare('SELECT id, username, totp_enabled FROM users').all();

if (!users.length) {
  console.log("Nessun utente configurato: non c'e' niente da disattivare.");
  process.exit(0);
}

const attivi = users.filter((u) => u.totp_enabled);
if (!attivi.length) {
  console.log('La verifica in due passaggi non e\' attiva per nessun utente.');
  process.exit(0);
}

const disattiva = db.transaction(() => {
  for (const user of attivi) {
    db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?').run(user.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
    console.log(`✓ Verifica in due passaggi disattivata per "${user.username}"`);
  }
});
disattiva();

console.log('');
console.log('Ora puoi entrare con username e password soltanto.');
console.log('Quando vuoi, riattivala da "Sicurezza" nel menu laterale.');
