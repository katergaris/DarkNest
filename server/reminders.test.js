const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// db.js legge DB_PATH al require: puntandola su ":memory:" i test non
// toccano mai il database reale sul disco.
process.env.DB_PATH = ':memory:';
const remindersRouter = require('./routes/reminders');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/reminders', remindersRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/reminders`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('crea, legge, aggiorna ed elimina una scadenza (ciclo completo)', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Rinnovo assicurazione', date: '2026-12-01', notes: 'controllare il preventivo' }),
    }).then((r) => r.json());
    assert.equal(created.label, 'Rinnovo assicurazione');
    assert.ok(created.id);

    const list = await fetch(base).then((r) => r.json());
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);

    const updated = await fetch(`${base}/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Rinnovo RC auto', date: created.date, notes: created.notes }),
    }).then((r) => r.json());
    assert.equal(updated.label, 'Rinnovo RC auto');

    const delRes = await fetch(`${base}/${created.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);

    const listAfter = await fetch(base).then((r) => r.json());
    assert.equal(listAfter.length, 0);
  });
});

test('rifiuta la creazione senza testo o senza data', async () => {
  await withServer(async (base) => {
    const noLabel = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-12-01' }),
    });
    assert.equal(noLabel.status, 400);

    const noDate = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Qualcosa' }),
    });
    assert.equal(noDate.status, 400);
  });
});

test('una scadenza eliminata (soft-delete) non compare piu\' nell\'elenco ma resta ripristinabile', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Da ripristinare', date: '2026-12-01' }),
    }).then((r) => r.json());

    await fetch(`${base}/${created.id}`, { method: 'DELETE' });
    assert.equal((await fetch(base).then((r) => r.json())).length, 0);

    const restoreRes = await fetch(`${base}/${created.id}/restore`, { method: 'POST' });
    assert.equal(restoreRes.status, 204);
    assert.equal((await fetch(base).then((r) => r.json())).length, 1);
  });
});
