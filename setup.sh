#!/usr/bin/env bash
# Script di installazione guidata per DarkNest (Linux / macOS).
# Controlla i prerequisiti, prepara il file .env con segreti generati
# automaticamente, avvia il container e attende che sia pronto.

set -euo pipefail
cd "$(dirname "$0")"

echo "== DarkNest — installazione =="
echo ""

# --- 1. Verifica Docker ---
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker non trovato."
  echo "  Installa Docker Desktop (https://docs.docker.com/get-docker/) e riesegui questo script."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "✗ Docker Compose non trovato."
  echo "  Aggiorna Docker Desktop, oppure installa docker-compose separatamente."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker non risulta avviato."
  echo "  Apri Docker Desktop (o avvia il servizio docker) e riesegui questo script."
  exit 1
fi

echo "✓ Docker trovato e avviato (userò: $COMPOSE)"

# --- 2. Prepara il file .env ---
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Creato .env dal template"
else
  echo "✓ File .env già presente, lo riuso"
fi

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

is_port_free() {
  node -e "
    const net = require('net');
    const srv = net.createServer();
    srv.once('error', () => process.exit(1));
    srv.once('listening', () => srv.close(() => process.exit(0)));
    srv.listen($1, '127.0.0.1');
  " >/dev/null 2>&1
}

if grep -q "cambiami-con-una-stringa-lunga-e-casuale" .env; then
  SECRET="$(random_hex)"
  sed -i.bak "s#cambiami-con-una-stringa-lunga-e-casuale#${SECRET}#" .env && rm -f .env.bak
  echo "✓ Generato SESSION_SECRET automaticamente"
fi

if grep -q "cambiami-con-una-passphrase-lunga-e-segreta" .env; then
  KEY="$(random_hex)"
  sed -i.bak "s#cambiami-con-una-passphrase-lunga-e-segreta#${KEY}#" .env && rm -f .env.bak
  echo "✓ Generato ENCRYPTION_KEY automaticamente"
  echo "  IMPORTANTE: fai una copia del file .env e conservala altrove."
  echo "  Senza ENCRYPTION_KEY le password salvate nel vault non sono recuperabili."
fi

# --- 3. Trova una porta libera sul computer ---
CURRENT_HOST_PORT="$(grep '^HOST_PORT=' .env | cut -d '=' -f2)"
CURRENT_HOST_PORT="${CURRENT_HOST_PORT:-3000}"
CANDIDATE_PORT="$CURRENT_HOST_PORT"
ATTEMPTS=0
while ! is_port_free "$CANDIDATE_PORT" && [ "$ATTEMPTS" -lt 50 ]; do
  CANDIDATE_PORT=$((CANDIDATE_PORT + 1))
  ATTEMPTS=$((ATTEMPTS + 1))
done

if [ "$ATTEMPTS" -ge 50 ]; then
  echo "✗ Non trovo una porta libera nell'intervallo ${CURRENT_HOST_PORT}-$((CURRENT_HOST_PORT + 50))."
  echo "  Libera manualmente una porta oppure imposta HOST_PORT nel file .env e riprova."
  exit 1
fi

if [ "$CANDIDATE_PORT" != "$CURRENT_HOST_PORT" ]; then
  echo "! La porta ${CURRENT_HOST_PORT} risulta occupata: uso la ${CANDIDATE_PORT} al suo posto."
  if grep -q '^HOST_PORT=' .env; then
    sed -i.bak "s#^HOST_PORT=.*#HOST_PORT=${CANDIDATE_PORT}#" .env && rm -f .env.bak
  else
    echo "HOST_PORT=${CANDIDATE_PORT}" >> .env
  fi
else
  echo "✓ Porta ${CANDIDATE_PORT} libera"
fi
PORT="$CANDIDATE_PORT"

# --- 4. Avvia il container ---
echo ""
echo "Avvio DarkNest (la prima volta può richiedere qualche minuto per scaricare e compilare le dipendenze)..."
$COMPOSE up -d --build

# --- 5. Attende che sia pronto ---
echo ""
echo -n "Attendo che DarkNest risponda su http://localhost:${PORT} "
READY=0
for _ in $(seq 1 40); do
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  else
    if node -e "require('http').get('http://localhost:${PORT}/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))" >/dev/null 2>&1; then READY=1; break; fi
  fi
  echo -n "."
  sleep 2
done
echo ""

if [ "$READY" = "1" ]; then
  echo ""
  echo "✓ DarkNest è pronto: http://localhost:${PORT}"
  echo "  Al primo accesso ti verrà chiesto di creare username e password."
else
  echo ""
  echo "DarkNest non ha ancora risposto. Può essere solo questione di qualche secondo in più,"
  echo "oppure qualcosa è andato storto. Controlla i log con:"
  echo "  $COMPOSE logs -f"
fi
