const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';
const projectsRouter = require('./routes/projects');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/projects', projectsRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/projects`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('crea un progetto con scadenza, contatti e budget, e li ritrova invariati', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Ristrutturazione bagno',
        deadline: '2026-12-01',
        contacts: ['Mario Rossi', 'idraulico'],
        budget: [{ label: 'Piastrelle', amount: 300 }, { label: 'Manodopera', amount: 500 }],
      }),
    }).then((r) => r.json());

    assert.equal(created.deadline, '2026-12-01');
    assert.deepEqual(created.contacts, ['Mario Rossi', 'idraulico']);
    assert.deepEqual(created.budget, [{ label: 'Piastrelle', amount: 300 }, { label: 'Manodopera', amount: 500 }]);

    const list = await fetch(base).then((r) => r.json());
    assert.equal(list[0].id, created.id);
    assert.deepEqual(list[0].budget, created.budget);
  });
});

test('aggiornare un progetto senza toccare budget/contatti li lascia invariati', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Orto', contacts: ['Anna'], budget: [{ label: 'Semi', amount: 12 }] }),
    }).then((r) => r.json());

    const updated = await fetch(`${base}/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Orto sul balcone' }),
    }).then((r) => r.json());

    assert.equal(updated.title, 'Orto sul balcone');
    assert.deepEqual(updated.contacts, ['Anna']);
    assert.deepEqual(updated.budget, [{ label: 'Semi', amount: 12 }]);
  });
});

test('un progetto senza scadenza/contatti/budget torna con array vuoti e scadenza nulla', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Idea al volo' }),
    }).then((r) => r.json());

    assert.equal(created.deadline, null);
    assert.deepEqual(created.contacts, []);
    assert.deepEqual(created.budget, []);
  });
});
