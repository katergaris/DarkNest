(() => {
  'use strict';

  // ---------------- API helper ----------------
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'same-origin',
      headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (res.status === 401) {
      showAuthScreen();
      throw new Error('Sessione scaduta');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* corpo vuoto */ }
    if (!res.ok) throw new Error((data && data.error) || 'Errore imprevisto');
    return data;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Il testo va accorciato PRIMA di essere convertito in HTML: tagliando dopo
  // l'escape si poteva spezzare un'entita' (&amp; -> &am) e sporcare la pagina.
  function escTrim(str, max) {
    const s = String(str ?? '');
    return esc(s.length > max ? s.slice(0, max) + '…' : s);
  }

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('it-IT'); } catch (e) { return d; }
  }

  function fmtSize(bytes) {
    if (!bytes) return '0 B';
    // Sotto il KB mostriamo i byte: prima qualsiasi file piccolo risultava "0 KB".
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  // ---------------- Modal ----------------
  const modalTpl = document.getElementById('tpl-modal');
  let activeModal = null;

  function openModal(title, bodyNode) {
    closeModal();
    const frag = modalTpl.content.cloneNode(true);
    const backdrop = frag.querySelector('.modal-backdrop');
    frag.querySelector('.modal-title').textContent = title;
    frag.querySelector('.modal-body').appendChild(bodyNode);
    frag.querySelector('.modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.body.appendChild(frag);
    activeModal = document.body.lastElementChild;
  }

  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  function el(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstElementChild;
  }

  // ---------------- Auth ----------------
  const authScreen = document.getElementById('auth-screen');
  const appRoot = document.getElementById('app');
  const authForm = document.getElementById('auth-form');
  const authSub = document.getElementById('auth-sub');
  const authError = document.getElementById('auth-error');
  const authSubmit = document.getElementById('auth-submit');
  let setupMode = false;

  function showAuthScreen() {
    appRoot.classList.add('hidden');
    authScreen.classList.remove('hidden');
  }

  async function checkAuth() {
    const status = await api('/auth/status');
    if (status.authenticated) {
      startApp();
      return;
    }
    setupMode = status.setupNeeded;
    authSub.textContent = setupMode
      ? 'Primo avvio: crea il tuo accesso personale.'
      : 'Il tuo spazio personale, al sicuro.';
    authSubmit.textContent = setupMode ? 'Crea accesso' : 'Entra';
    showAuthScreen();
  }

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    try {
      if (setupMode) {
        await api('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      } else {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      }
      startApp();
    } catch (err) {
      authError.textContent = err.message;
      authError.classList.remove('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      // Anche se la chiamata fallisce ricarichiamo: la sessione va comunque chiusa lato client.
    }
    location.reload();
  });

  function startApp() {
    authScreen.classList.add('hidden');
    appRoot.classList.remove('hidden');
    render('dashboard');
  }

  // ---------------- Navigation ----------------
  const nav = document.getElementById('nav');
  const viewRoot = document.getElementById('view-root');

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    render(btn.dataset.view);
  });

  function setActiveNav(view) {
    nav.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }

  const views = {}; // popolate piu' sotto

  async function render(view, opts = {}) {
    setActiveNav(view);
    viewRoot.innerHTML = '';
    const loading = el('<div class="empty-state">Carico…</div>');
    viewRoot.appendChild(loading);
    try {
      await views[view](viewRoot, opts);
    } catch (err) {
      viewRoot.innerHTML = '';
      viewRoot.appendChild(el(`<div class="empty-state">Errore: ${esc(err.message)}</div>`));
    }
  }

  // ---------------- Collegamento a fascicolo (riutilizzabile) ----------------
  async function openLinkToDossierModal(itemType, itemId, itemLabel) {
    const dossiers = await api('/dossiers');
    const wrap = el('<div></div>');
    if (!dossiers.length) {
      wrap.appendChild(el('<p class="card-sub">Non hai ancora nessun fascicolo. Creane uno dalla sezione Fascicoli.</p>'));
    } else {
      dossiers.forEach((d) => {
        const row = el(`
          <div class="trash-row">
            <span>${esc(d.title)}</span>
            <button class="btn btn-sm btn-primary">Collega</button>
          </div>
        `);
        row.querySelector('button').addEventListener('click', async () => {
          await api(`/dossiers/${d.id}/links`, {
            method: 'POST',
            body: JSON.stringify({ item_type: itemType, item_id: itemId }),
          });
          toast(`"${itemLabel}" collegato a "${d.title}"`);
          closeModal();
        });
        wrap.appendChild(row);
      });
    }
    openModal('Collega a un fascicolo', wrap);
  }

  // ==================================================================
  // DASHBOARD
  // ==================================================================
  views.dashboard = async (root) => {
    const [reminders, ideas, projects, vault, accounts, documents] = await Promise.all([
      api('/search/reminders/upcoming?days=45'),
      api('/ideas'), api('/projects'), api('/vault'), api('/accounts'), api('/drive'),
    ]);
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header"><h2>Dashboard</h2></div>
      <div class="woven-divider"></div>
    `));

    const grid = el('<div class="dashboard-grid"></div>');

    const remindersBlock = el('<div class="section-block"><h3>Scadenze in arrivo</h3></div>');
    if (!reminders.length) {
      remindersBlock.appendChild(el('<p class="card-sub">Nessuna scadenza nei prossimi 45 giorni.</p>'));
    } else {
      const list = el('<div class="reminder-list"></div>');
      reminders.forEach((r) => {
        list.appendChild(el(`
          <div class="reminder-item">
            <span>${esc(r.label)} <span class="card-sub">(${r.type === 'account' ? 'account' : 'documento'})</span></span>
            <span class="reminder-date">${fmtDate(r.date)}</span>
          </div>
        `));
      });
      remindersBlock.appendChild(list);
    }
    grid.appendChild(remindersBlock);

    const statsBlock = el('<div class="section-block"><h3>Panoramica</h3></div>');
    const stats = [
      ['Idee', ideas.length], ['Progetti', projects.length], ['Voci vault', vault.length],
      ['Account', accounts.length], ['Documenti', documents.length],
    ];
    const statsList = el('<div class="reminder-list"></div>');
    stats.forEach(([label, count]) => {
      statsList.appendChild(el(`<div class="reminder-item"><span>${label}</span><span class="reminder-date">${count}</span></div>`));
    });
    statsBlock.appendChild(statsList);
    grid.appendChild(statsBlock);

    root.appendChild(grid);
  };

  // ==================================================================
  // IDEE
  // ==================================================================
  function ideaModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Titolo</label><input type="text" name="title" required /></div>
        <div class="form-row"><label>Descrizione</label><textarea name="body" rows="5"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.title.value = existing.title;
      form.body.value = existing.body;
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  views.ideas = async (root) => {
    const ideas = await api('/ideas');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Idee</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-idea">+ Nuova idea</button></div>
      </div>
    `));

    root.querySelector('#new-idea').addEventListener('click', () => {
      const form = ideaModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
        await api('/ideas', { method: 'POST', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
        closeModal(); toast('Idea salvata'); render('ideas');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova idea', form);
    });

    if (!ideas.length) {
      root.appendChild(el('<div class="empty-state">Nessuna idea ancora. Butta giu\' la prima.</div>'));
      return;
    }

    const grid = el('<div class="grid"></div>');
    ideas.forEach((idea) => {
      const card = el(`
        <div class="card">
          <p class="card-title">${esc(idea.title)}</p>
          <p class="card-body">${escTrim(idea.body, 220)}</p>
          <div class="tag-row">${(idea.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </div>
        </div>
      `);
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = ideaModal(idea);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
          await api(`/ideas/${idea.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
          closeModal(); toast('Idea aggiornata'); render('ideas');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica idea', form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('idea', idea.id, idea.title));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questa idea nel cestino?')) return;
        await api(`/ideas/${idea.id}`, { method: 'DELETE' });
        toast('Idea eliminata'); render('ideas');
      });
      grid.appendChild(card);
    });
    root.appendChild(grid);
  };

  // ==================================================================
  // PROGETTI
  // ==================================================================
  function projectModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Titolo</label><input type="text" name="title" required /></div>
        <div class="form-row"><label>Descrizione</label><textarea name="description" rows="4"></textarea></div>
        <div class="form-row"><label>Stato</label>
          <select name="status">
            <option value="da_fare">Da fare</option>
            <option value="in_corso">In corso</option>
            <option value="fatto">Fatto</option>
          </select>
        </div>
        <div class="form-row"><label>Checklist (una voce per riga)</label><textarea name="checklist" rows="4" placeholder="es. Comprare i materiali"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.title.value = existing.title;
      form.description.value = existing.description;
      form.status.value = existing.status;
      form.checklist.value = (existing.checklist || []).map((c) => c.text).join('\n');
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  views.projects = async (root) => {
    const projects = await api('/projects');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Progetti</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-project">+ Nuovo progetto</button></div>
      </div>
    `));

    function collectChecklist(form, previous) {
      const lines = form.checklist.value.split('\n').map((l) => l.trim()).filter(Boolean);
      const prevMap = new Map((previous || []).map((c) => [c.text, c.done]));
      return lines.map((text) => ({ text, done: prevMap.get(text) || false }));
    }

    root.querySelector('#new-project').addEventListener('click', () => {
      const form = projectModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
        const checklist = collectChecklist(form, []);
        await api('/projects', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value, status: form.status.value, checklist, tags }) });
        closeModal(); toast('Progetto creato'); render('projects');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo progetto', form);
    });

    if (!projects.length) {
      root.appendChild(el('<div class="empty-state">Nessun progetto ancora.</div>'));
      return;
    }

    const grid = el('<div class="grid"></div>');
    projects.forEach((p) => {
      const done = (p.checklist || []).filter((c) => c.done).length;
      const total = (p.checklist || []).length;
      const card = el(`
        <div class="card">
          <span class="status-pill status-${p.status}">${p.status.replace('_', ' ')}</span>
          <p class="card-title">${esc(p.title)}</p>
          <p class="card-body">${escTrim(p.description, 160)}</p>
          ${total ? `<p class="card-sub">Checklist: ${done}/${total} completati</p>` : ''}
          <div class="tag-row">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </div>
        </div>
      `);
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = projectModal(p);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
          const checklist = collectChecklist(form, p.checklist);
          await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, description: form.description.value, status: form.status.value, checklist, tags }) });
          closeModal(); toast('Progetto aggiornato'); render('projects');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica progetto', form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('project', p.id, p.title));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questo progetto nel cestino?')) return;
        await api(`/projects/${p.id}`, { method: 'DELETE' });
        toast('Progetto eliminato'); render('projects');
      });
      grid.appendChild(card);
    });
    root.appendChild(grid);
  };

  // ==================================================================
  // VAULT
  // ==================================================================
  function vaultModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Sito / servizio</label><input type="text" name="site" required /></div>
        <div class="form-row"><label>Username</label><input type="text" name="username" /></div>
        <div class="form-row"><label>Password ${existing ? '(lascia vuoto per non cambiarla)' : ''}</label><input type="text" name="password" ${existing ? '' : 'required'} /></div>
        <div class="form-row"><label>URL</label><input type="text" name="url" /></div>
        <div class="form-row"><label>Note</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.site.value = existing.site;
      form.username.value = existing.username;
      form.url.value = existing.url;
      form.notes.value = existing.notes;
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  views.vault = async (root) => {
    const entries = await api('/vault');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Vault</h2>
        <div class="view-header-actions">
          <label class="btn btn-ghost" style="cursor:pointer">
            Importa CSV
            <input type="file" id="csv-input" accept=".csv" class="hidden" />
          </label>
          <button class="btn btn-primary" id="new-vault">+ Nuova voce</button>
        </div>
      </div>
      <p class="card-sub">L'import CSV riconosce colonne come site/name/title, username/login/email, password, url, notes.</p>
    `));

    root.querySelector('#csv-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const result = await api('/vault/import', { method: 'POST', body: fd });
        toast(`Importate ${result.imported} voci (${result.skipped} saltate)`);
        render('vault');
      } catch (err) {
        toast('Import fallito: ' + err.message);
      }
    });

    root.querySelector('#new-vault').addEventListener('click', () => {
      const form = vaultModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
        await api('/vault', { method: 'POST', body: JSON.stringify({ site: form.site.value, username: form.username.value, password: form.password.value, url: form.url.value, notes: form.notes.value, tags }) });
        closeModal(); toast('Voce salvata'); render('vault');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova voce vault', form);
    });

    if (!entries.length) {
      root.appendChild(el('<div class="empty-state">Il vault e\' vuoto.</div>'));
      return;
    }

    entries.forEach((entry) => {
      const row = el(`
        <div class="vault-row">
          <strong>${esc(entry.site)}</strong>
          <span>${esc(entry.username) || '—'}</span>
          <span class="password-field" data-pwd>••••••••</span>
          <span class="card-actions" style="padding:0">
            <button class="btn btn-sm" data-reveal>Mostra</button>
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </span>
        </div>
      `);
      let revealed = false;
      row.querySelector('[data-reveal]').addEventListener('click', async (btn) => {
        const pwdEl = row.querySelector('[data-pwd]');
        if (!revealed) {
          const full = await api(`/vault/${entry.id}/reveal`);
          pwdEl.textContent = full.password || '(vuota)';
          revealed = true;
          row.querySelector('[data-reveal]').textContent = 'Nascondi';
        } else {
          pwdEl.textContent = '••••••••';
          revealed = false;
          row.querySelector('[data-reveal]').textContent = 'Mostra';
        }
      });
      row.querySelector('[data-edit]').addEventListener('click', () => {
        const form = vaultModal(entry);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
          const payload = { site: form.site.value, username: form.username.value, url: form.url.value, notes: form.notes.value, tags };
          if (form.password.value) payload.password = form.password.value;
          await api(`/vault/${entry.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          closeModal(); toast('Voce aggiornata'); render('vault');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica voce vault', form);
      });
      row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('vault', entry.id, entry.site));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questa voce nel cestino?')) return;
        await api(`/vault/${entry.id}`, { method: 'DELETE' });
        toast('Voce eliminata'); render('vault');
      });
      root.appendChild(row);
    });
  };

  // ==================================================================
  // ACCOUNT
  // ==================================================================
  function accountModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Servizio</label><input type="text" name="service" required /></div>
        <div class="form-row"><label>Email</label><input type="text" name="email" /></div>
        <div class="form-row"><label>Piano</label><input type="text" name="plan" /></div>
        <div class="form-row"><label>Data di rinnovo</label><input type="date" name="renewal_date" /></div>
        <div class="form-row"><label>Note</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.service.value = existing.service;
      form.email.value = existing.email;
      form.plan.value = existing.plan;
      form.renewal_date.value = existing.renewal_date ? existing.renewal_date.slice(0, 10) : '';
      form.notes.value = existing.notes;
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  views.accounts = async (root) => {
    const accounts = await api('/accounts');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Account</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-account">+ Nuovo account</button></div>
      </div>
    `));

    root.querySelector('#new-account').addEventListener('click', () => {
      const form = accountModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
        await api('/accounts', { method: 'POST', body: JSON.stringify({ service: form.service.value, email: form.email.value, plan: form.plan.value, renewal_date: form.renewal_date.value || null, notes: form.notes.value, tags }) });
        closeModal(); toast('Account salvato'); render('accounts');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo account', form);
    });

    if (!accounts.length) {
      root.appendChild(el('<div class="empty-state">Nessun account ancora.</div>'));
      return;
    }

    const grid = el('<div class="grid"></div>');
    accounts.forEach((a) => {
      const card = el(`
        <div class="card">
          <p class="card-title">${esc(a.service)}</p>
          <p class="card-sub">${esc(a.email) || '—'} ${a.plan ? '· ' + esc(a.plan) : ''}</p>
          ${a.renewal_date ? `<p class="card-sub">Rinnovo: ${fmtDate(a.renewal_date)}</p>` : ''}
          <div class="tag-row">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </div>
        </div>
      `);
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = accountModal(a);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
          await api(`/accounts/${a.id}`, { method: 'PUT', body: JSON.stringify({ service: form.service.value, email: form.email.value, plan: form.plan.value, renewal_date: form.renewal_date.value || null, notes: form.notes.value, tags }) });
          closeModal(); toast('Account aggiornato'); render('accounts');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica account', form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('account', a.id, a.service));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questo account nel cestino?')) return;
        await api(`/accounts/${a.id}`, { method: 'DELETE' });
        toast('Account eliminato'); render('accounts');
      });
      grid.appendChild(card);
    });
    root.appendChild(grid);
  };

  // ==================================================================
  // DRIVE
  // ==================================================================
  views.drive = async (root) => {
    const docs = await api('/drive');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Drive</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-doc">+ Carica documento</button></div>
      </div>
    `));

    root.querySelector('#new-doc').addEventListener('click', () => {
      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row"><label>File</label><input type="file" name="file" required /></div>
          <div class="form-row"><label>Cartella</label><input type="text" name="folder" placeholder="es. Casa, Auto, Fiscale" /></div>
          <div class="form-row"><label>Scadenza (opzionale)</label><input type="date" name="expiry_date" /></div>
          <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Carica</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
        const fd = new FormData();
        fd.append('file', form.file.files[0]);
        fd.append('folder', form.folder.value);
        fd.append('expiry_date', form.expiry_date.value || '');
        fd.append('tags', JSON.stringify(tags));
        await api('/drive', { method: 'POST', body: fd });
        closeModal(); toast('Documento caricato'); render('drive');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Carica documento', form);
    });

    if (!docs.length) {
      root.appendChild(el('<div class="empty-state">Nessun documento ancora.</div>'));
      return;
    }

    docs.forEach((d) => {
      const row = el(`
        <div class="doc-row">
          <div>
            <div class="doc-name">${esc(d.original_name)}</div>
            <div class="doc-meta">${d.folder ? esc(d.folder) + ' · ' : ''}${fmtSize(d.size)}${d.expiry_date ? ' · scade ' + fmtDate(d.expiry_date) : ''}</div>
          </div>
          <span class="card-actions" style="padding:0">
            <a class="btn btn-sm" href="/api/drive/${d.id}/download">Scarica</a>
            <button class="btn btn-sm" data-link>Fascicolo</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </span>
        </div>
      `);
      row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('document', d.id, d.original_name));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questo documento nel cestino?')) return;
        await api(`/drive/${d.id}`, { method: 'DELETE' });
        toast('Documento eliminato'); render('drive');
      });
      root.appendChild(row);
    });
  };

  // ==================================================================
  // FASCICOLI
  // ==================================================================
  views.dossiers = async (root) => {
    const dossiers = await api('/dossiers');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Fascicoli</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-dossier">+ Nuovo fascicolo</button></div>
      </div>
      <p class="card-sub">Un fascicolo raccoglie insieme documenti, password, account e idee legati allo stesso tema. Collega gli elementi dai loro pulsanti "Fascicolo".</p>
    `));

    root.querySelector('#new-dossier').addEventListener('click', () => {
      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row"><label>Titolo</label><input type="text" name="title" required /></div>
          <div class="form-row"><label>Descrizione</label><textarea name="description" rows="3"></textarea></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Crea</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/dossiers', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value }) });
        closeModal(); toast('Fascicolo creato'); render('dossiers');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo fascicolo', form);
    });

    if (!dossiers.length) {
      root.appendChild(el('<div class="empty-state">Nessun fascicolo ancora.</div>'));
      return;
    }

    const grid = el('<div class="grid"></div>');
    dossiers.forEach((d) => {
      const card = el(`
        <div class="card">
          <p class="card-title">${esc(d.title)}</p>
          <p class="card-body">${esc(d.description)}</p>
          <div class="dossier-items"></div>
          <div class="card-actions">
            <button class="btn btn-sm btn-danger" data-del>Elimina fascicolo</button>
          </div>
        </div>
      `);
      const itemsWrap = card.querySelector('.dossier-items');
      if (!d.items.length) {
        itemsWrap.appendChild(el('<span class="card-sub">Nessun elemento collegato.</span>'));
      }
      d.items.forEach((item) => {
        const chip = el(`
          <span class="dossier-chip"><span class="chip-type">${esc(item.type)}</span>${esc(item.label)} <button title="Scollega">✕</button></span>
        `);
        chip.querySelector('button').addEventListener('click', async () => {
          await api(`/dossiers/${d.id}/links/${item.type}/${item.id}`, { method: 'DELETE' });
          toast('Elemento scollegato'); render('dossiers');
        });
        itemsWrap.appendChild(chip);
      });
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questo fascicolo nel cestino? Gli elementi collegati non verranno eliminati.')) return;
        await api(`/dossiers/${d.id}`, { method: 'DELETE' });
        toast('Fascicolo eliminato'); render('dossiers');
      });
      grid.appendChild(card);
    });
    root.appendChild(grid);
  };

  // ==================================================================
  // CESTINO
  // ==================================================================
  const TYPE_LABELS = { idea: 'Idea', project: 'Progetto', vault: 'Vault', account: 'Account', document: 'Documento', dossier: 'Fascicolo' };

  views.trash = async (root) => {
    const items = await api('/trash');
    root.innerHTML = '';
    root.appendChild(el('<div class="view-header"><h2>Cestino</h2></div>'));

    if (!items.length) {
      root.appendChild(el('<div class="empty-state">Il cestino e\' vuoto.</div>'));
      return;
    }

    items.forEach((item) => {
      const row = el(`
        <div class="trash-row">
          <span><span class="chip-type">${esc(TYPE_LABELS[item.type] || item.type)}</span> &nbsp;${esc(item.label)}</span>
          <span class="card-actions" style="padding:0">
            <button class="btn btn-sm" data-restore>Ripristina</button>
            <button class="btn btn-sm btn-danger" data-purge>Elimina definitivamente</button>
          </span>
        </div>
      `);
      row.querySelector('[data-restore]').addEventListener('click', async () => {
        await api(`/trash/${item.type}/${item.id}/restore`, { method: 'POST' });
        toast('Ripristinato'); render('trash');
      });
      row.querySelector('[data-purge]').addEventListener('click', async () => {
        if (!confirm('Eliminare definitivamente? L\'operazione non e\' reversibile.')) return;
        await api(`/trash/${item.type}/${item.id}`, { method: 'DELETE' });
        toast('Eliminato definitivamente'); render('trash');
      });
      root.appendChild(row);
    });
  };

  // ---------------- Global search ----------------
  const searchInput = document.getElementById('global-search');
  const searchResults = document.getElementById('search-results');
  let searchTimer = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchResults.classList.add('hidden'); return; }
    searchTimer = setTimeout(async () => {
      let results;
      try {
        results = await api('/search?q=' + encodeURIComponent(q));
      } catch (err) {
        searchResults.innerHTML = '';
        searchResults.appendChild(el(`<div class="search-result-item">${esc(err.message)}</div>`));
        searchResults.classList.remove('hidden');
        return;
      }
      // La ricerca puo' rispondere fuori ordine: ignoriamo i risultati vecchi.
      if (searchInput.value.trim() !== q) return;
      searchResults.innerHTML = '';
      if (!results.length) {
        searchResults.appendChild(el('<div class="search-result-item">Nessun risultato</div>'));
      } else {
        results.slice(0, 20).forEach((r) => {
          const item = el(`<div class="search-result-item"><span>${esc(r.label)}</span><span class="search-result-tag">${esc(TYPE_LABELS[r.type] || r.type)}</span></div>`);
          item.addEventListener('click', () => {
            searchResults.classList.add('hidden');
            searchInput.value = '';
            const viewMap = { idea: 'ideas', project: 'projects', vault: 'vault', account: 'accounts', document: 'drive', dossier: 'dossiers' };
            render(viewMap[r.type] || 'dashboard');
          });
          searchResults.appendChild(item);
        });
      }
      searchResults.classList.remove('hidden');
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) searchResults.classList.add('hidden');
  });

  // Molti handler fanno "await api(...)" senza try/catch: senza questa rete di
  // sicurezza un errore restava solo in console e per l'utente non succedeva nulla.
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason && e.reason.message ? e.reason.message : 'Errore imprevisto';
    if (msg !== 'Sessione scaduta') toast(msg);
    e.preventDefault();
  });

  // ---------------- Avvio ----------------
  checkAuth().catch((err) => {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
    showAuthScreen();
  });
})();
