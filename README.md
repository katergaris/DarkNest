# DarkNest

Spazio personale self-hosted per idee, progetti, password, account e documenti — con **fascicoli** che li collegano tra loro. Gira interamente sul tuo computer o server, dentro Docker: nessun dato lascia la tua macchina.

## Cosa contiene

- **Idee** — note libere con tag
- **Progetti** — stato (da fare / in corso / fatto) e checklist
- **Vault password** — voci cifrate (AES-256-GCM), con **import da CSV**
- **Account** — anagrafica servizi con data di rinnovo
- **Drive** — upload documenti, organizzati in cartelle, con scadenza opzionale
- **Fascicoli** — collegano insieme idee, progetti, voci del vault, account e documenti su uno stesso tema
- **Dashboard** — scadenze in arrivo (account e documenti) e panoramica
- **Ricerca globale** — cerca in tutte le sezioni insieme
- **Cestino** — eliminazione soft con possibilità di ripristino
- **Backup** — esporta un file .zip con database e documenti caricati

## Requisiti

Solo **Docker Desktop** (Windows/macOS) o **Docker Engine + Docker Compose** (Linux). Nient'altro — Node.js, database o altre dipendenze vengono gestiti automaticamente dentro il container.

- Scarica Docker Desktop: https://docs.docker.com/get-docker/
- Assicurati che sia **avviato** prima di procedere (l'icona della balena nella barra delle applicazioni/menu bar).

## Avvio rapido

1. Scarica questo repository (`Code → Download ZIP` su GitHub, oppure `git clone`) ed estrailo.
2. Apri un terminale nella cartella del progetto ed esegui lo script adatto al tuo sistema:

   **Linux / macOS**
   ```bash
   ./setup.sh
   ```

   **Windows (PowerShell)**
   ```powershell
   .\setup.ps1
   ```

Lo script controlla che Docker sia installato e avviato, crea automaticamente il file `.env` con dei segreti generati in modo casuale (non devi scrivere nulla a mano), **verifica se la porta 3000 è libera e, se è occupata, ne sceglie automaticamente un'altra libera**, avvia il container e ti avvisa quando l'app è pronta — mostrandoti l'indirizzo esatto da aprire.

3. Apri il browser all'indirizzo che lo script ti indica (di norma **http://localhost:3000**, oppure un'altra porta se la 3000 era occupata). Al primo accesso ti verrà chiesto di creare il tuo username e la password.

> Se lo script segnala un permesso negato su Linux/macOS, rendilo eseguibile con `chmod +x setup.sh` e rilancialo.

### Avvio manuale (alternativa allo script)

Se preferisci farlo a mano:

```bash
cp env.example .env
# apri .env e sostituisci i due valori segnaposto con stringhe casuali lunghe
docker compose up -d --build
```

## Dati e persistenza

- `./data/darknest.db` — database SQLite (idee, progetti, metadati vault/account/documenti/fascicoli)
- `./uploads/` — file caricati nel Drive

Entrambe le cartelle sono montate come volumi Docker: i dati sopravvivono a riavvii e rebuild del container. Fanne comunque un backup periodico (vedi sotto) e **non cancellare mai `.env`** — contiene la chiave con cui sono cifrate le password nel vault.

## Backup

Dal menu laterale, "Esporta backup" scarica uno `.zip` con il database e tutti i documenti del Drive. Conservalo, insieme a una copia del file `.env`, in un posto sicuro e separato dal server.

## Import CSV nel vault

Nella sezione Vault, "Importa CSV" accetta file con intestazioni comuni (esportazioni da browser o altri password manager):

| Campo riconosciuto | Intestazioni accettate |
|---|---|
| Sito | `site`, `name`, `title` |
| Username | `username`, `login`, `email`, `user` |
| Password | `password`, `pass` |
| URL | `url`, `link`, `website` |
| Note | `notes`, `note`, `comment` |

Sono obbligatorie almeno le colonne per sito e password. Le righe incomplete vengono saltate e segnalate a fine import.

## Risoluzione dei problemi

**Lo script dice che Docker non è avviato**
Apri Docker Desktop e attendi che l'icona nella barra indichi "Running", poi rilancia lo script.

**La porta 3000 è già occupata**
Se usi `setup.sh` o `setup.ps1`, non devi fare nulla: lo script se ne accorge da solo e sceglie automaticamente la prima porta libera successiva, aggiornando `HOST_PORT` in `.env`. Se invece avvii tutto a mano, modifica `HOST_PORT` in `.env` (es. `HOST_PORT=3001`) e rilancia `docker compose up -d --build` — non serve toccare `docker-compose.yml`.

**`docker compose` non è riconosciuto**
Su installazioni più datate il comando è `docker-compose` (con il trattino). Gli script di setup lo rilevano automaticamente; se lanci i comandi a mano, usa quello disponibile sul tuo sistema.

**Ho perso il file `.env` / la ENCRYPTION_KEY**
Le password salvate nel vault non sono più recuperabili senza la chiave originale: è una conseguenza della cifratura, non un bug. Per questo lo script ti avvisa di conservarne una copia. Il resto dei dati (idee, progetti, account, documenti, fascicoli) non viene toccato.

**Voglio vedere cosa succede durante l'avvio**
```bash
docker compose logs -f
```

**Voglio ripartire da zero**
```bash
docker compose down
rm -rf data uploads   # attenzione: cancella tutti i dati salvati
./setup.sh
```

## Sicurezza — cosa sapere

- Le password del vault sono cifrate con AES-256-GCM; la chiave deriva dalla `ENCRYPTION_KEY` che imposti tu (o che lo script genera per te) e non viene mai salvata nel database.
- L'accesso all'app è protetto da un singolo utente (username + password, hash bcrypt) con sessione via cookie.
- Questo è uno strumento pensato per uso personale su una rete che controlli (rete domestica, VPN, NAS). Non ha avuto un audit di sicurezza professionale: per password particolarmente critiche, valuta di affiancare uno strumento dedicato e verificato come Vaultwarden, usando DarkNest per il resto.
- Se esponi DarkNest su internet, mettilo dietro HTTPS (es. reverse proxy con Caddy/Traefik/Nginx) e considera un livello aggiuntivo di autenticazione (es. VPN).

## Struttura del progetto

```
darknest/
├── setup.sh / setup.ps1   # installazione guidata (Linux-macOS / Windows)
├── docker-compose.yml
├── Dockerfile
├── env.example
├── LICENSE
├── package.json
├── server/
│   ├── index.js            # server Express, autenticazione, sessioni, health check
│   ├── db.js                # connessione SQLite e schema
│   ├── crypto.js             # cifratura AES-256-GCM del vault
│   ├── auth.js                 # setup utente, login, middleware
│   ├── session-store.js         # sessioni salvate su SQLite (sopravvivono ai riavvii)
│   └── routes/                  # API REST per ogni sezione
└── public/                       # frontend (HTML/CSS/JS, nessuna build richiesta)
```

## Licenza

Distribuito con licenza MIT — vedi [LICENSE](LICENSE). Puoi usarlo, modificarlo e ridistribuirlo liberamente.
