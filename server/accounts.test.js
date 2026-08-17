const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';
const accountsRouter = require('./routes/accounts');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/accounts', accountsRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/accounts`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('un abbonamento senza tipo dichiarato e\' digitale di default', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'Netflix', email: 'me@example.com' }),
    }).then((r) => r.json());
    assert.equal(created.type, 'digitale');
  });
});

test('un abbonamento cartaceo salva luogo e modalita\' di pagamento', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'Rivista mensile', type: 'cartaceo', location: 'Edicola di via Roma', payment_method: 'contanti' }),
    }).then((r) => r.json());
    assert.equal(created.type, 'cartaceo');
    assert.equal(created.location, 'Edicola di via Roma');
    assert.equal(created.payment_method, 'contanti');
  });
});

test('un tipo non valido viene ignorato e resta digitale', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'Qualcosa', type: 'non-esiste' }),
    }).then((r) => r.json());
    assert.equal(created.type, 'digitale');
  });
});
