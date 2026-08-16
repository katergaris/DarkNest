(() => {
  'use strict';

  // ---------------- API helper ----------------
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'same-origin',
      headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...opts,
    });
    // Un 401 sulle rotte di accesso e' una credenziale sbagliata, non una
    // sessione scaduta: va lasciato passare alla schermata di login, che sa
    // spiegare cosa manca (password errata, codice a due fattori, ...).
    if (res.status === 401 && !path.startsWith('/auth/')) {
      showAuthScreen();
      throw new Error('Sessione scaduta');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* corpo vuoto */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Errore imprevisto');
      err.status = res.status;
      err.data = data || {};
      throw err;
    }
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

  function parseTags(form) {
    return form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
  }

  function checklistProgress(list) {
    const total = (list || []).length;
    const done = (list || []).filter((c) => c.done).length;
    return { done, total };
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
    // Con una connessione lenta, piu' click sul pulsante "Salva" prima che la
    // prima richiesta finisca creavano piu' voci identiche. Il bottone si
    // riabilita da solo dopo un po' nel caso la richiesta fallisca e la
    // finestra resti aperta (altrimenti non si potrebbe piu' riprovare).
    const form = bodyNode.tagName === 'FORM' ? bodyNode : bodyNode.querySelector('form');
    const submitBtn = form && form.querySelector('button[type="submit"]');
    if (form && submitBtn) {
      form.addEventListener('submit', () => {
        submitBtn.disabled = true;
        setTimeout(() => { submitBtn.disabled = false; }, 8000);
      });
    }
    document.body.appendChild(frag);
    activeModal = document.body.lastElementChild;
  }

  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModal();
    const backdrop = document.getElementById('sheet-backdrop');
    if (backdrop && !backdrop.classList.contains('hidden')) {
      backdrop.classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }
  });

  function el(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    // Con piu' elementi al primo livello restituiamo un frammento: prima ne
    // usciva solo il primo e il resto spariva senza avvisare (era il caso del
    // divisore della dashboard e dei testi di aiuto di Vault e Fascicoli).
    if (div.children.length > 1) {
      const frag = document.createDocumentFragment();
      while (div.firstChild) frag.appendChild(div.firstChild);
      return frag;
    }
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

  const authCodeRow = document.getElementById('auth-code-row');
  const authCodeInput = document.getElementById('auth-code');

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const code = authCodeInput.value.trim();
    try {
      if (setupMode) {
        await api('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      } else {
        await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify(code ? { username, password, code } : { username, password }),
        });
      }
      startApp();
    } catch (err) {
      // La password e' giusta ma manca il secondo fattore: mostriamo il campo
      // del codice invece di far ricominciare da capo.
      if (err.data && err.data.totpRequired) {
        authCodeRow.classList.remove('hidden');
        authCodeInput.value = '';
        authCodeInput.focus();
        authSubmit.textContent = 'Verifica ed entra';
      }
      authError.textContent = err.message;
      authError.classList.remove('hidden');
    }
  });

  // Dichiarazione (non costante) perche' viene usata anche dal foglio del
  // telefono, costruito prima di questo punto del file.
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      // Anche se la chiamata fallisce ricarichiamo: la sessione va comunque chiusa lato client.
    }
    location.reload();
  }

  document.getElementById('logout-btn').addEventListener('click', logout);

  function startApp() {
    authScreen.classList.add('hidden');
    appRoot.classList.remove('hidden');
    render('flusso');
  }

  // ---------------- Navigation ----------------
  // Icone pixel-art (griglia 8x8, stile retro a 8 bit): ogni stringa e' una
  // riga, '#' un pixel acceso. Niente file o servizi esterni: solo <rect>
  // generati da questa mappa, un pittogramma con un significato per voce
  // invece di un tratto astratto.
  const ICONS = {
    flusso:     ['................', '................', '...###..........', '...####.........', '...#####........', '...######.......', '...#######......', '...########.....', '...########.....', '...#######......', '...######.......', '...#####........', '...####.........', '...###..........', '................', '................'],
    dashboard:  ['................', '.######..######.', '.######..######.', '.######..######.', '.######..######.', '.######..######.', '.######..######.', '................', '................', '.######..######.', '.######..######.', '.######..######.', '.######..######.', '.######..######.', '.######..######.', '................'],
    ideas:      ['................', '................', '......####......', '.....######.....', '....########....', '....########....', '....########....', '....########....', '.....######.....', '......####......', '......####......', '................', '.....######.....', '................', '......####......', '................'],
    projects:   ['................', '................', '.####...........', '.####..########.', '.####..########.', '.####...........', '................', '.####...........', '.####..########.', '.####..########.', '.####...........', '................', '.####...........', '.####..########.', '.####..########.', '.####...........'],
    vault:      ['................', '.......###......', '......#####.....', '.....#######....', '....###...###...', '....###...###...', '....###...###...', '....#########...', '...###########..', '...###########..', '...###########..', '...###########..', '...###########..', '...###########..', '...###########..', '................'],
    accounts:   ['................', '................', '.......###......', '......#####.....', '.....#######....', '.....#######....', '.....#######....', '......#####.....', '.......###......', '......#####.....', '....#########...', '...###########..', '..#############.', '..#############.', '..#############.', '................'],
    drive:      ['................', '................', '..##########....', '..#.........#...', '..#..######..#..', '..#..#....#..#..', '..#..#....#..#..', '..#..######..#..', '..#..........#..', '..#..######..#..', '..#..######..#..', '..#..######..#..', '..#..######..#..', '..############..', '................', '................'],
    dossiers:   ['................', '................', '................', '................', '..#####.........', '..#####.........', '..#############.', '..#...........#.', '..#...........#.', '..#...........#.', '..#...........#.', '..#...........#.', '..#...........#.', '..#############.', '................', '................'],
    trash:      ['................', '......####......', '......####......', '...##########...', '...##########...', '....########....', '....#......#....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#......#....', '....########....', '................'],
    security:   ['................', '..#############.', '..#############.', '..#############.', '..#############.', '..#####..######.', '..###.......###.', '..###.......###.', '..#####..######.', '..#####..######.', '...###########..', '....#########...', '......#####.....', '.......###......', '........#.......', '................'],
    piu:        ['................', '................', '................', '................', '................', '................', '................', '..###..###..###.', '..###..###..###.', '..###..###..###.', '................', '................', '................', '................', '................', '................'],
    cerca:      ['................', '................', '.....###........', '....#####.......', '...#######......', '..###...###.....', '..###...###.....', '..###...###.....', '...#######......', '....#######.....', '.....###.###....', '..........###...', '...........###..', '............###.', '.............###', '..............#.'],
    chiudi:     ['................', '................', '..##.........##.', '..###.......##..', '...###.....##...', '....###...##....', '.....###.##.....', '......####......', '.......###......', '......#####.....', '.....##..###....', '....##....###...', '...##......###..', '..##........###.', '..#..........#..', '................'],
    backup:     ['................', '.......##.......', '.......##.......', '.......##.......', '.......##.......', '.......##.......', '....##.##.##....', '.....######.....', '......####......', '.......##.......', '..############..', '..#..........#..', '..#..........#..', '..#..........#..', '..############..', '................'],
    esci:       ['................', '................', '..#######.......', '..#.....#.......', '..#.....#.##....', '..#.....#..##...', '..#.....#...##..', '..#.....#.#####.', '..#.....#.#####.', '..#.....#...##..', '..#.....#..##...', '..#.....#.##....', '..#.....#.......', '..#######.......', '................', '................'],
  };

  function icona(nome) {
    const bitmap = ICONS[nome];
    if (!bitmap) return '';
    let rects = '';
    bitmap.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    });
    return `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // Elenco unico delle sezioni: da qui nascono sia il menu laterale del
  // computer sia la barra in basso e il foglio del telefono, cosi' non possono
  // piu' andare fuori sincrono.
  const SECTIONS = [
    { view: 'flusso', label: 'Flusso', tab: true },
    { view: 'dashboard', label: 'Dashboard' },
    { view: 'ideas', label: 'Idee', tab: true },
    { view: 'projects', label: 'Progetti' },
    { view: 'vault', label: 'Vault', tab: true },
    { view: 'accounts', label: 'Account' },
    { view: 'drive', label: 'Drive', tab: true },
    { view: 'dossiers', label: 'Fascicoli' },
    { view: 'trash', label: 'Cestino' },
    { view: 'security', label: 'Sicurezza' },
  ];

  const nav = document.getElementById('nav');
  const viewRoot = document.getElementById('view-root');
  const tabbar = document.getElementById('tabbar');
  const sheet = document.getElementById('sheet');
  const sheetBackdrop = document.getElementById('sheet-backdrop');

  // Menu laterale (schermo largo): raggruppato Flusso / Fascicoli / Archivi.
  // Tabbar e foglio restano piatti (SECTIONS), invariati sotto.
  const FLUSSO_FILTERS = [
    { filter: 'oggi', label: 'oggi' },
    { filter: 'settimana', label: 'questa settimana' },
    { filter: 'senza-fascicolo', label: 'senza fascicolo' },
  ];

  const flussoSection = SECTIONS.find((s) => s.view === 'flusso');
  const flussoGroup = el('<div class="sidebar-group"></div>');
  flussoGroup.appendChild(el('<div class="sidebar-group-title">Flusso</div>'));
  flussoGroup.appendChild(el(`
    <button class="nav-item" data-view="flusso">${icona('flusso')}<span>${esc(flussoSection.label)}</span></button>
  `));
  FLUSSO_FILTERS.forEach((f) => {
    const row = el(`<button class="sub-nav-item" data-filter="${f.filter}"><span>${esc(f.label)}</span></button>`);
    row.addEventListener('click', () => { closeSheet(); render('flusso', { filter: f.filter }); });
    flussoGroup.appendChild(row);
  });
  nav.appendChild(flussoGroup);

  const fascicoliGroup = el('<div class="sidebar-group"></div>');
  fascicoliGroup.appendChild(el('<div class="sidebar-group-title">Fascicoli</div>'));
  const dossierTree = el('<div id="sidebar-dossier-tree"></div>');
  fascicoliGroup.appendChild(dossierTree);
  nav.appendChild(fascicoliGroup);

  // Conteggi per tipo mostrati sotto ogni fascicolo espanso.
  const TREE_TYPE_LABELS = { document: 'documenti', idea: 'idee', project: 'progetti', account: 'account', vault: 'vault' };
  // Sezione in cui vive ciascun tipo di elemento collegato a un fascicolo:
  // usata per aprire l'elemento cliccandolo, invece di poterlo solo scollegare.
  const TYPE_TO_VIEW = { document: 'drive', idea: 'ideas', project: 'projects', account: 'accounts', vault: 'vault' };
  const expandedDossiers = new Set();

  async function refreshSidebarDossiers() {
    let dossiers;
    try { dossiers = await api('/dossiers'); } catch (err) { return; }
    dossierTree.innerHTML = '';
    if (!dossiers.length) {
      dossierTree.appendChild(el('<div class="tree-empty">Nessun fascicolo ancora.</div>'));
      return;
    }
    dossiers.forEach((d) => {
      const wrap = el('<div></div>');
      const open = expandedDossiers.has(d.id);
      const row = el(`
        <button type="button" class="tree-dossier">
          <span class="tree-dossier-toggle ${open ? 'open' : ''}">▸</span>
          <span class="tree-dossier-dot">◆</span>
          <span class="tree-dossier-label">${esc(d.title)}</span>
          <span class="tree-dossier-count">${d.items.length}</span>
        </button>
      `);
      const subWrap = el(`<div class="${open ? '' : 'hidden'}"></div>`);
      const groups = {};
      d.items.forEach((it) => { (groups[it.type] = groups[it.type] || []).push(it); });
      const groupKeys = Object.keys(groups);
      if (!groupKeys.length) {
        subWrap.appendChild(el('<div class="tree-empty">Nessun elemento collegato.</div>'));
      } else {
        groupKeys.forEach((type) => {
          const subRow = el(`
            <button type="button" class="tree-sub">
              <span class="tree-sub-dot">·</span><span>${esc(TREE_TYPE_LABELS[type] || type)}</span>
              <span class="tree-sub-count">${groups[type].length}</span>
            </button>
          `);
          subRow.addEventListener('click', () => { closeSheet(); render('dossiers', { highlight: d.id }); });
          subWrap.appendChild(subRow);
        });
      }
      row.querySelector('.tree-dossier-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const nowHidden = subWrap.classList.toggle('hidden');
        row.querySelector('.tree-dossier-toggle').classList.toggle('open', !nowHidden);
        if (nowHidden) expandedDossiers.delete(d.id); else expandedDossiers.add(d.id);
      });
      row.addEventListener('click', () => { closeSheet(); render('dossiers', { highlight: d.id }); });
      wrap.appendChild(row);
      wrap.appendChild(subWrap);
      dossierTree.appendChild(wrap);
    });
  }

  const archiviGroup = el('<div class="sidebar-group"></div>');
  archiviGroup.appendChild(el('<div class="sidebar-group-title">Archivi</div>'));
  SECTIONS.filter((s) => s.view !== 'flusso').forEach((s) => {
    archiviGroup.appendChild(el(`
      <button class="nav-item" data-view="${s.view}">${icona(s.view)}<span>${esc(s.label)}</span></button>
    `));
  });
  nav.appendChild(archiviGroup);

  // Barra in basso (telefono): le sezioni piu' usate piu' "Altro"
  SECTIONS.filter((s) => s.tab).forEach((s) => {
    tabbar.appendChild(el(`
      <button class="tab-item" data-view="${s.view}">${icona(s.view)}<span>${esc(s.label)}</span></button>
    `));
  });
  const tabPiu = el(`<button class="tab-item" id="tab-piu">${icona('piu')}<span>Altro</span></button>`);
  tabbar.appendChild(tabPiu);

  // Foglio con l'elenco completo, cosi' nessuna sezione resta difficile da trovare
  function buildSheet() {
    sheet.innerHTML = '';
    sheet.appendChild(el('<div class="sheet-handle" aria-hidden="true"></div>'));
    sheet.appendChild(el('<h3 class="sheet-title">Tutte le sezioni</h3>'));
    const list = el('<div class="sheet-list"></div>');
    SECTIONS.forEach((s) => {
      list.appendChild(el(`
        <button class="sheet-item" data-view="${s.view}">${icona(s.view)}<span>${esc(s.label)}</span></button>
      `));
    });
    sheet.appendChild(list);

    const azioni = el('<div class="sheet-list sheet-actions"></div>');
    azioni.appendChild(el(`
      <a class="sheet-item" href="/api/backup" target="_blank" rel="noopener">${icona('backup')}<span>Esporta backup</span></a>
    `));
    const esci = el(`<button class="sheet-item" data-logout>${icona('esci')}<span>Esci</span></button>`);
    esci.addEventListener('click', logout);
    azioni.appendChild(esci);
    sheet.appendChild(azioni);
  }
  buildSheet();

  function openSheet() {
    sheetBackdrop.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  }
  function closeSheet() {
    sheetBackdrop.classList.add('hidden');
    document.body.classList.remove('no-scroll');
  }

  tabPiu.addEventListener('click', openSheet);
  sheetBackdrop.addEventListener('click', (e) => { if (e.target === sheetBackdrop) closeSheet(); });

  // Un solo gestore per menu laterale, barra in basso e foglio.
  [nav, tabbar, sheet].forEach((contenitore) => {
    contenitore.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      closeSheet();
      render(btn.dataset.view);
    });
  });

  function setActiveNav(view, opts = {}) {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.sub-nav-item').forEach((b) => {
      b.classList.toggle('active', view === 'flusso' && !!opts.filter && b.dataset.filter === opts.filter);
    });
    // Se la sezione attiva non e' fra quelle della barra, resta evidenziato "Altro".
    tabPiu.classList.toggle('active', !SECTIONS.some((s) => s.tab && s.view === view));
  }

  // ---------------- Breadcrumb + tab di vista ----------------
  const crumbbar = document.getElementById('crumbbar');
  const VIEW_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.view, s.label.toLowerCase()]));
  const FLUSSO_FILTER_LABELS = { oggi: 'oggi', settimana: 'questa settimana', 'senza-fascicolo': 'senza fascicolo' };
  const VIEW_TABS = [
    { key: 'flusso', label: 'flusso' },
    { key: 'tabella', label: 'tabella' },
    { key: 'bacheca', label: 'bacheca' },
    { key: 'orbita', label: 'orbita' },
  ];

  function updateCrumb(view, opts = {}) {
    crumbbar.innerHTML = '';
    const path = el('<div class="crumb-path"></div>');
    path.appendChild(el('<span>~</span>'));
    path.appendChild(el('<span class="crumb-sep">/</span>'));
    path.appendChild(el(`<span${opts.filter ? '' : ' class="crumb-current"'}>${esc(VIEW_LABELS[view] || view)}</span>`));
    if (view === 'flusso' && opts.filter) {
      path.appendChild(el('<span class="crumb-sep">/</span>'));
      path.appendChild(el(`<span class="crumb-current">${esc(FLUSSO_FILTER_LABELS[opts.filter] || opts.filter)}</span>`));
    }
    crumbbar.appendChild(path);

    if (view === 'flusso') {
      const tabs = el('<div class="view-tabs"></div>');
      VIEW_TABS.forEach((t) => {
        const btn = el(`<button type="button" class="view-tab ${t.key === 'flusso' ? 'active' : ''}">${esc(t.label)}</button>`);
        btn.addEventListener('click', () => {
          if (t.key === 'flusso') { render('flusso'); return; }
          toast('Vista in arrivo');
        });
        tabs.appendChild(btn);
      });
      crumbbar.appendChild(tabs);
    }
  }

  const views = {}; // popolate piu' sotto

  // Chiusura del menu "/", "@", "#" del composer al click fuori: un solo
  // listener sul documento, riassegnato da views.flusso ad ogni render.
  // Prima veniva registrato un nuovo listener ad ogni visita del Flusso e
  // non veniva mai rimosso, accumulandosi per tutta la sessione.
  let composerMenuOutsideClick = null;
  document.addEventListener('click', (e) => {
    if (composerMenuOutsideClick) composerMenuOutsideClick(e);
  });

  async function render(view, opts = {}) {
    setActiveNav(view, opts);
    updateCrumb(view, opts);
    viewRoot.innerHTML = '';
    const loading = el('<div class="empty-state">Carico…</div>');
    viewRoot.appendChild(loading);
    try {
      await views[view](viewRoot, opts);
    } catch (err) {
      viewRoot.innerHTML = '';
      viewRoot.appendChild(el(`<div class="empty-state">Errore: ${esc(err.message)}</div>`));
    }
    refreshNavCounts();
  }

  // ---------------- Contatori nel menu laterale ----------------
  // Chiamata ad ogni render(): dato lo scopo personale dell'app i volumi sono
  // piccoli, quindi qualche chiamata in piu' per tenere i numeri aggiornati
  // dopo ogni creazione/eliminazione e' un compromesso ragionevole.
  async function refreshNavCounts() {
    refreshSidebarDossiers();
    let ideas, projects, vault, accounts, docs, dossiers, trash;
    try {
      [ideas, projects, vault, accounts, docs, dossiers, trash] = await Promise.all([
        api('/ideas'), api('/projects'), api('/vault'), api('/accounts'), api('/drive'),
        api('/dossiers'), api('/trash'),
      ]);
    } catch (err) {
      return; // chrome non critico: se fallisce lasciamo lo stato precedente
    }
    const counts = {
      ideas: ideas.length, projects: projects.length, vault: vault.length,
      accounts: accounts.length, drive: docs.length, dossiers: dossiers.length, trash: trash.length,
    };
    document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
      const c = counts[btn.dataset.view];
      let badge = btn.querySelector('.nav-count');
      if (c === undefined) { if (badge) badge.remove(); return; }
      if (!badge) { badge = el('<span class="nav-count"></span>'); btn.appendChild(badge); }
      badge.textContent = c;
    });
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
          <div class="trash-row row-card">
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
  // FLUSSO (composer + feed unico, con scadenze/fascicoli/statistiche a lato)
  // ==================================================================
  function dayLabel(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const startOf = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    const giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    if (diffDays === 0) return `OGGI · ${giorni[d.getDay()].toUpperCase()} ${d.getDate()}`;
    if (diffDays === 1) return 'IERI';
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }).toUpperCase();
  }

  function fmtTime(dateStr) {
    try { return new Date(dateStr).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  const FLUSSO_API_TYPE = { idea: 'idea', progetto: 'project', account: 'account', documento: 'document' };
  // Percorso REST (e vista di destinazione) per ciascun tipo di elemento del flusso:
  // "documento" e' l'unico dove il nome del tipo non coincide col nome della sezione/rotta.
  const FLUSSO_SECTION = { idea: 'ideas', progetto: 'projects', account: 'accounts', documento: 'drive' };

  // Evidenzia i "#tag" dentro un testo gia' passato da escTrim/esc (sicuro:
  // i caratteri delle entita' HTML non fanno parte di \w, quindi non si spezzano).
  function hashtagify(escapedStr) {
    return escapedStr.replace(/#([a-zA-Z0-9_-]+)/g, '<span class="entry-hashtag">#$1</span>');
  }

  function renderEntryCard(item, linkIndex) {
    const apiType = FLUSSO_API_TYPE[item.kind];
    const links = linkIndex.get(`${apiType}:${item.id}`) || [];

    const card = el('<div class="entry-block"></div>');
    const body = el('<div class="entry-card-body"></div>');
    body.appendChild(el(`
      <div class="entry-meta">
        <span class="entry-type">[${esc(item.kind)}]</span>
        <span class="entry-time">${fmtTime(item.created_at)}</span>
        ${links[0] ? `<span class="entry-fascicolo">◆ ${esc(links[0].title)}</span>` : ''}
      </div>
    `));

    if (item.kind === 'idea') {
      body.appendChild(el(`<div class="entry-text">${hashtagify(escTrim(item.body || item.title, 260))}</div>`));
      if ((item.tags || []).length) {
        body.appendChild(el(`<div class="tag-row" style="margin-top:9px">${item.tags.map((t) => `<span class="tag tag-neutral">${esc(t)}</span>`).join('')}</div>`));
      }
    } else if (item.kind === 'documento') {
      body.appendChild(el(`<div class="entry-text">Caricato: ${escTrim(item.original_name, 160)}</div>`));
      const ext = (item.original_name.includes('.') ? item.original_name.split('.').pop() : '').toUpperCase().slice(0, 4);
      body.appendChild(el(`
        <div class="entry-doc">
          <span class="entry-doc-ext">${esc(ext || 'FILE')}</span>
          <div style="flex:1;min-width:0">
            <div class="entry-doc-name">${esc(item.original_name)}</div>
            <div class="entry-doc-meta">${fmtSize(item.size)}${item.folder ? ' · ' + esc(item.folder) : ''}</div>
          </div>
        </div>
      `));
    } else if (item.kind === 'progetto') {
      body.appendChild(el(`<div class="entry-text">${esc(item.title)}</div>`));
      const { done, total } = checklistProgress(item.checklist);
      if (total) {
        const pct = Math.round((done / total) * 100);
        body.appendChild(el(`
          <div class="entry-progress">
            <div class="entry-progress-track"><div class="entry-progress-fill" style="width:${pct}%"></div></div>
            <span class="entry-progress-label">${done}/${total}</span>
          </div>
        `));
      } else {
        body.appendChild(el(`<span class="status-pill status-${item.status}" style="margin-top:6px">${item.status.replace('_', ' ')}</span>`));
      }
    } else if (item.kind === 'account') {
      body.appendChild(el(`<div class="entry-text">${esc(item.service)}${item.renewal_date ? ' — rinnovo ' + fmtDate(item.renewal_date) : ''}</div>`));
    }
    card.appendChild(body);

    const actions = el('<div class="entry-actions"></div>');
    const collega = el('<button type="button">Collega</button>');
    collega.addEventListener('click', () => openLinkToDossierModal(apiType, item.id, item.title || item.service || item.original_name));
    actions.appendChild(collega);

    const modifica = el('<button type="button">Modifica</button>');
    modifica.addEventListener('click', () => {
      if (item.kind === 'idea') {
        const form = ideaModal(item);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = parseTags(form);
          await api(`/ideas/${item.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
          closeModal(); toast('Idea aggiornata'); render('flusso');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica idea', form);
      } else {
        // account/progetto/documento: la modifica completa vive gia' nella loro sezione.
        render(FLUSSO_SECTION[item.kind]);
      }
    });
    actions.appendChild(modifica);

    const elimina = el('<button type="button">Elimina</button>');
    elimina.addEventListener('click', async () => {
      if (!confirm('Spostare questo elemento nel cestino?')) return;
      await api(`/${FLUSSO_SECTION[item.kind]}/${item.id}`, { method: 'DELETE' });
      toast('Spostato nel cestino'); render('flusso');
    });
    actions.appendChild(elimina);

    if (links.length) {
      actions.appendChild(el(`<span class="entry-actions-meta">${links.length} collegament${links.length === 1 ? 'o' : 'i'}</span>`));
    } else if (item.kind === 'documento') {
      actions.appendChild(el(`<a href="/api/drive/${item.id}/download" class="entry-actions-meta" style="text-decoration:none">apri</a>`));
    }
    card.appendChild(actions);
    return card;
  }

  views.flusso = async (root, opts = {}) => {
    const [ideas, projects, accounts, documents, dossiers, reminders] = await Promise.all([
      api('/ideas'), api('/projects'), api('/accounts'), api('/drive'),
      api('/dossiers'), api('/search/reminders/upcoming?days=45'),
    ]);

    // Mappa elemento -> fascicoli a cui e' collegato: alimenta sia il chip
    // "◆ nome" sotto ogni voce del flusso sia le statistiche a lato.
    const linkIndex = new Map();
    dossiers.forEach((d) => {
      d.items.forEach((item) => {
        const key = `${item.type}:${item.id}`;
        if (!linkIndex.has(key)) linkIndex.set(key, []);
        linkIndex.get(key).push({ id: d.id, title: d.title });
      });
    });

    const allEntries = [
      ...ideas.map((x) => ({ kind: 'idea', ...x })),
      ...projects.map((x) => ({ kind: 'progetto', ...x })),
      ...accounts.map((x) => ({ kind: 'account', ...x })),
      ...documents.map((x) => ({ kind: 'documento', ...x })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Sotto-filtri della sidebar (Flusso > oggi / questa settimana / senza fascicolo).
    let entries = allEntries;
    if (opts.filter === 'oggi') {
      entries = entries.filter((x) => dayLabel(x.created_at).startsWith('OGGI'));
    } else if (opts.filter === 'settimana') {
      const weekAgo = Date.now() - 7 * 86400000;
      entries = entries.filter((x) => new Date(x.created_at).getTime() >= weekAgo);
    } else if (opts.filter === 'senza-fascicolo') {
      entries = entries.filter((x) => !linkIndex.has(`${FLUSSO_API_TYPE[x.kind]}:${x.id}`));
    }
    entries = entries.slice(0, 60);

    root.innerHTML = '';
    root.appendChild(el('<div class="view-header"><h2>Flusso</h2></div>'));

    const layout = el('<div class="flusso-layout"></div>');
    const main = el('<div></div>');
    const rail = el('<aside class="right-rail"></aside>');

    // ---- composer a blocco: "/" per il tipo, "@" per collegare un fascicolo ----
    let selectedDossier = null;
    const composer = el(`
      <div class="composer">
        <textarea id="flusso-text" placeholder="Scrivi un'idea — o / per un altro tipo, @ per un fascicolo, # per un tag" rows="2"></textarea>
        <div id="flusso-link-badge"></div>
        <div class="composer-row">
          <button type="button" class="chip" data-insert="/idea">/idea</button>
          <button type="button" class="chip" data-insert="/doc">/doc</button>
          <button type="button" class="chip" data-insert="/scadenza" title="In arrivo">/scadenza</button>
          <button type="button" class="chip" data-insert="/progetto">/progetto</button>
          <button type="button" class="chip chip-fascicolo" data-insert="@">@fascicolo</button>
          <button type="button" class="chip" data-insert="#">#tag</button>
          <button type="button" class="btn btn-primary" id="flusso-save">Salva</button>
        </div>
        <div class="composer-hint">
          <span><span class="kb">Ctrl</span>+<span class="kb">Invio</span> salva</span>
          <span>/ per il tipo · @ per collegare un fascicolo · # per un tag</span>
        </div>
      </div>
    `);
    const textarea = composer.querySelector('#flusso-text');
    const linkBadgeWrap = composer.querySelector('#flusso-link-badge');
    // Tag gia' usati nelle idee esistenti, suggeriti mentre si scrive "#".
    const knownTags = [...new Set(ideas.flatMap((x) => x.tags || []))].sort();

    function renderLinkBadge() {
      linkBadgeWrap.innerHTML = '';
      if (!selectedDossier) return;
      const badge = el(`<span class="composer-link-badge">→ ${esc(selectedDossier.title)} <button type="button" title="Rimuovi">✕</button></span>`);
      badge.querySelector('button').addEventListener('click', () => { selectedDossier = null; renderLinkBadge(); });
      linkBadgeWrap.appendChild(badge);
    }

    // ---- autocomplete /comandi e @fascicolo ----
    const COMMANDS = [
      { token: '/idea', desc: 'nota veloce' },
      { token: '/doc', desc: 'carica documento' },
      { token: '/scadenza', desc: 'in arrivo' },
      { token: '/progetto', desc: 'nuovo progetto' },
    ];
    let menuEl = null;
    let menuItems = [];
    let menuActive = 0;
    let menuTrigger = null;

    function closeMenu() {
      if (menuEl) { menuEl.remove(); menuEl = null; }
      menuItems = [];
      menuTrigger = null;
    }

    function highlightMenu() {
      if (!menuEl) return;
      menuEl.querySelectorAll('.composer-menu-item').forEach((n, i) => n.classList.toggle('active', i === menuActive));
    }

    async function selectMenuItem(i) {
      const item = menuItems[i];
      const trigger = menuTrigger;
      closeMenu();
      if (!item || !trigger) return;

      if (trigger.type === '#') {
        // il tag e' testo vero e proprio: si completa restando nella frase,
        // non viene rimosso come i comandi "/" e le menzioni "@".
        const before = textarea.value.slice(0, trigger.start);
        const after = textarea.value.slice(trigger.end);
        const needsSpace = !/^\s/.test(after);
        textarea.value = before + item.token + (needsSpace ? ' ' : '') + after;
        const caret = before.length + item.token.length + (needsSpace ? 1 : 0);
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        return;
      }

      // rimuove il token digitato ("/xxx" o "@xxx") dal testo, mantenendo il resto
      const before = textarea.value.slice(0, trigger.start);
      const after = textarea.value.slice(trigger.end);
      textarea.value = before + after;
      const caret = before.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);

      if (trigger.type === '@') {
        selectedDossier = item.dossier;
        renderLinkBadge();
        return;
      }
      if (item.token === '/idea') return; // e' gia' il tipo di default
      if (item.token === '/scadenza') { toast('In arrivo'); return; }
      if (item.token === '/doc') {
        await render('drive');
        const btn = document.getElementById('new-doc');
        if (btn) btn.click();
        return;
      }
      if (item.token === '/progetto') {
        await render('projects');
        const btn = document.getElementById('new-project');
        if (btn) btn.click();
      }
    }

    function openMenu(items) {
      if (menuEl) { menuEl.remove(); menuEl = null; }
      if (!items.length) { menuItems = []; return; }
      menuItems = items;
      menuActive = 0;
      menuEl = el('<div class="composer-menu"></div>');
      items.forEach((it, i) => {
        const row = el(`
          <div class="composer-menu-item ${i === 0 ? 'active' : ''}">
            <span class="cmi-token">${esc(it.token)}</span><span class="cmi-desc">${esc(it.desc)}</span>
          </div>
        `);
        row.addEventListener('mousedown', (e) => { e.preventDefault(); selectMenuItem(i); });
        menuEl.appendChild(row);
      });
      composer.appendChild(menuEl);
    }

    function currentTrigger() {
      const pos = textarea.selectionStart;
      const upToCaret = textarea.value.slice(0, pos);
      const match = upToCaret.match(/(^|\s)([/@#][^\s]*)$/);
      if (!match) return null;
      const tokenStart = pos - match[2].length;
      return { type: match[2][0], query: match[2].slice(1).toLowerCase(), start: tokenStart, end: pos };
    }

    function updateMenu() {
      const trigger = currentTrigger();
      menuTrigger = trigger;
      if (!trigger) { closeMenu(); return; }
      if (trigger.type === '/') {
        openMenu(COMMANDS.filter((c) => c.token.slice(1).startsWith(trigger.query)));
      } else if (trigger.type === '@') {
        openMenu(
          dossiers
            .filter((d) => d.title.toLowerCase().includes(trigger.query))
            .map((d) => ({ token: '@' + d.title, desc: 'fascicolo', dossier: d }))
        );
      } else {
        openMenu(
          knownTags
            .filter((t) => t.toLowerCase().startsWith(trigger.query))
            .map((t) => ({ token: '#' + t, desc: 'tag' }))
        );
      }
    }

    textarea.addEventListener('input', updateMenu);
    textarea.addEventListener('click', updateMenu);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveEntry(); return; }
      if (!menuEl) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); menuActive = (menuActive + 1) % menuItems.length; highlightMenu(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); menuActive = (menuActive - 1 + menuItems.length) % menuItems.length; highlightMenu(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMenuItem(menuActive); }
      else if (e.key === 'Escape') { closeMenu(); }
    });
    composerMenuOutsideClick = (e) => {
      if (menuEl && !composer.contains(e.target)) closeMenu();
    };

    // Chip sotto il testo: scorciatoie che inseriscono il trigger e aprono subito il menu.
    composer.querySelectorAll('[data-insert]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const insert = chip.dataset.insert;
        const pos = textarea.selectionStart;
        const needsSpace = pos > 0 && !/\s/.test(textarea.value[pos - 1] || '');
        const prefix = needsSpace ? ' ' : '';
        textarea.value = textarea.value.slice(0, pos) + prefix + insert + textarea.value.slice(pos);
        const caret = pos + prefix.length + insert.length;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        updateMenu();
      });
    });

    let saving = false;
    async function saveEntry() {
      const text = textarea.value.trim();
      if (!text || saving) return;
      saving = true;
      const saveBtn = composer.querySelector('#flusso-save');
      saveBtn.disabled = true;
      try {
        const title = text.length > 80 ? text.slice(0, 80) + '…' : text;
        // I tag restano nel testo (come su Twitter/Notion): li estraiamo solo
        // per popolare il campo "tags" gia' usato altrove per filtrare/raggruppare.
        const tags = [...new Set((text.match(/#([a-zA-Z0-9_-]+)/g) || []).map((t) => t.slice(1)))];
        const idea = await api('/ideas', { method: 'POST', body: JSON.stringify({ title, body: text, tags }) });
        if (selectedDossier) {
          await api(`/dossiers/${selectedDossier.id}/links`, { method: 'POST', body: JSON.stringify({ item_type: 'idea', item_id: idea.id }) });
        }
        toast('Aggiunto al flusso');
        render('flusso', opts);
      } finally {
        saving = false;
        saveBtn.disabled = false;
      }
    }
    composer.querySelector('#flusso-save').addEventListener('click', saveEntry);
    main.appendChild(composer);

    // ---- feed ----
    if (!entries.length) {
      main.appendChild(el('<div class="empty-state">Il flusso e\' vuoto: scrivi qualcosa qui sopra.</div>'));
    } else {
      let lastLabel = null;
      entries.forEach((item) => {
        const label = dayLabel(item.created_at);
        if (label !== lastLabel) {
          main.appendChild(el(`<div class="day-label">${esc(label)}</div>`));
          lastLabel = label;
        }
        main.appendChild(renderEntryCard(item, linkIndex));
      });
    }
    layout.appendChild(main);

    // ---- right rail (statistiche sull'intero flusso, non sul sotto-filtro attivo) ----
    const deadlinesBlock = el('<div class="rail-block"><h6>Scadenze</h6></div>');
    if (!reminders.length) {
      deadlinesBlock.appendChild(el('<p class="card-sub">Nessuna scadenza nei prossimi 45 giorni.</p>'));
    } else {
      reminders.slice(0, 6).forEach((r) => {
        const days = Math.round((new Date(r.date) - new Date()) / 86400000);
        const cls = days < 0 ? 'overdue' : days <= 7 ? 'soon' : '';
        deadlinesBlock.appendChild(el(`
          <div class="rail-deadline">
            <span class="rail-deadline-days ${cls}">${days < 0 ? days : '+' + days}</span>
            <span>${esc(r.label)}</span>
          </div>
        `));
      });
    }
    rail.appendChild(deadlinesBlock);

    const dossiersBlock = el('<div class="rail-block"><h6>Fascicoli attivi</h6></div>');
    if (!dossiers.length) {
      dossiersBlock.appendChild(el('<p class="card-sub">Nessun fascicolo ancora.</p>'));
    } else {
      [...dossiers].sort((a, b) => b.items.length - a.items.length).slice(0, 6).forEach((d, i) => {
        const row = el(`
          <button type="button" class="rail-dossier ${i === 0 ? 'top' : ''}">
            <span class="rail-dossier-dot">◆</span><span class="rail-dossier-label">${esc(d.title)}</span><span class="rail-dossier-count">${d.items.length}</span>
          </button>
        `);
        row.addEventListener('click', () => render('dossiers', { highlight: d.id }));
        dossiersBlock.appendChild(row);
      });
    }
    rail.appendChild(dossiersBlock);

    const weekBlock = el('<div class="rail-block"><h6>Questa settimana</h6></div>');
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = allEntries.filter((x) => new Date(x.created_at).getTime() >= weekAgo);
    const unlinked = allEntries.filter((x) => !linkIndex.has(`${FLUSSO_API_TYPE[x.kind]}:${x.id}`)).length;
    weekBlock.appendChild(el(`
      <div class="rail-stats">
        <div>${recent.filter((x) => x.kind === 'idea').length} note · ${recent.filter((x) => x.kind === 'documento').length} documenti</div>
        <div>${recent.filter((x) => x.kind === 'progetto').length} progetti mossi</div>
        <div>${unlinked} voci senza fascicolo</div>
      </div>
    `));
    rail.appendChild(weekBlock);

    layout.appendChild(rail);
    root.appendChild(layout);
    textarea.focus();
  };

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
        const row = el(`
          <button type="button" class="reminder-item reminder-item-link">
            <span>${esc(r.label)} <span class="card-sub">(${r.type === 'account' ? 'account' : 'documento'})</span></span>
            <span class="reminder-date">${fmtDate(r.date)}</span>
          </button>
        `);
        row.addEventListener('click', () => render(TYPE_TO_VIEW[r.type], { highlight: r.id }));
        list.appendChild(row);
      });
      remindersBlock.appendChild(list);
    }
    grid.appendChild(remindersBlock);

    const statsBlock = el('<div class="section-block"><h3>Panoramica</h3></div>');
    const stats = [
      ['Idee', 'ideas', ideas.length], ['Progetti', 'projects', projects.length], ['Voci vault', 'vault', vault.length],
      ['Account', 'accounts', accounts.length], ['Documenti', 'drive', documents.length],
    ];
    const statsList = el('<div class="reminder-list"></div>');
    stats.forEach(([label, view, count]) => {
      const row = el(`<button type="button" class="reminder-item reminder-item-link"><span>${label}</span><span class="reminder-date">${count}</span></button>`);
      row.addEventListener('click', () => render(view));
      statsList.appendChild(row);
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

  views.ideas = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
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
        const tags = parseTags(form);
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
          const tags = parseTags(form);
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
      if (highlightId && String(idea.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  views.projects = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
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
        const tags = parseTags(form);
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
      const { done, total } = checklistProgress(p.checklist);
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
          const tags = parseTags(form);
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
      if (highlightId && String(p.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  views.vault = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
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
        const tags = parseTags(form);
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
        <div class="vault-row row-card">
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
          const tags = parseTags(form);
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
      if (highlightId && String(entry.id) === highlightId) row.classList.add('card-highlight');
      root.appendChild(row);
    });
    if (highlightId) {
      const target = root.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  views.accounts = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
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
        const tags = parseTags(form);
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
          const tags = parseTags(form);
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
      if (highlightId && String(a.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // DRIVE
  // ==================================================================
  views.drive = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
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
        const tags = parseTags(form);
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
        <div class="doc-row row-card">
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
      if (highlightId && String(d.id) === highlightId) row.classList.add('card-highlight');
      root.appendChild(row);
    });
    if (highlightId) {
      const target = root.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // FASCICOLI
  // ==================================================================
  views.dossiers = async (root, opts = {}) => {
    const dossiers = await api('/dossiers');
    const highlightId = opts.highlight ? String(opts.highlight) : null;
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
          <span class="dossier-chip" role="button" tabindex="0" title="Apri"><span class="chip-type">${esc(item.type)}</span>${esc(item.label)} <button title="Scollega">✕</button></span>
        `);
        chip.addEventListener('click', () => {
          const view = TYPE_TO_VIEW[item.type];
          if (view) render(view, { highlight: item.id });
        });
        chip.querySelector('button').addEventListener('click', async (e) => {
          e.stopPropagation();
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
      if (highlightId && String(d.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
        <div class="trash-row row-card">
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

  // ==================================================================
  // SICUREZZA (verifica in due passaggi)
  // ==================================================================
  function showRecoveryCodes(codes) {
    const wrap = el('<div></div>');
    wrap.appendChild(el(`
      <p class="card-sub">Conservali <strong>ora</strong>: stampali o mettili in un posto sicuro,
      lontano dal telefono. Ognuno funziona una volta sola e servono per entrare se perdi
      il telefono. Non potrai piu' rivederli.</p>
    `));
    const list = el('<div class="recovery-codes"></div>');
    codes.forEach((c) => list.appendChild(el(`<code>${esc(c)}</code>`)));
    wrap.appendChild(list);

    const actions = el('<div class="form-actions"></div>');
    const copy = el('<button type="button" class="btn btn-ghost">Copia tutti</button>');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codes.join('\n'));
        toast('Codici copiati');
      } catch (e) {
        toast('Copia non riuscita: selezionali a mano');
      }
    });
    const done = el('<button type="button" class="btn btn-primary">Li ho salvati</button>');
    done.addEventListener('click', () => { closeModal(); render('security'); });
    actions.appendChild(copy);
    actions.appendChild(done);
    wrap.appendChild(actions);
    openModal('Codici di recupero', wrap);
  }

  function askPassword(title, testo, onConfirm) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <p class="card-sub">${esc(testo)}</p>
        <div class="form-row"><label>Password</label><input type="password" name="password" required /></div>
        <p class="form-error hidden" data-err></p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Conferma</button>
        </div>
      </form>
    `);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('[data-err]');
      errEl.classList.add('hidden');
      try {
        await onConfirm(form.password.value);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    openModal(title, form);
  }

  function startTotpSetup() {
    api('/security/totp/setup', { method: 'POST' }).then((data) => {
      const wrap = el('<div class="totp-setup"></div>');
      wrap.appendChild(el(`
        <ol class="totp-steps">
          <li>Apri <strong>Google Authenticator</strong> (o Aegis, 1Password, Authy: vanno tutte bene) e tocca "+".</li>
          <li>Scegli "Scansiona un codice QR" e inquadra questo:</li>
        </ol>
      `));
      const qr = el(`<div class="qr-box">${data.qr}</div>`);
      wrap.appendChild(qr);
      wrap.appendChild(el(`
        <p class="card-sub">Se non riesci a inquadrarlo, nell'app scegli "Inserisci chiave di configurazione"
        e digita:<br /><code class="totp-secret">${esc(data.secret)}</code></p>
      `));

      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row">
            <label>Scrivi il codice a 6 cifre che vedi nell'app</label>
            <input type="text" name="code" inputmode="numeric" maxlength="7" placeholder="123456" required />
          </div>
          <p class="form-error hidden" data-err></p>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Attiva</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = form.querySelector('[data-err]');
        errEl.classList.add('hidden');
        try {
          const res = await api('/security/totp/enable', {
            method: 'POST',
            body: JSON.stringify({ code: form.code.value }),
          });
          closeModal();
          toast('Verifica in due passaggi attiva');
          showRecoveryCodes(res.recoveryCodes);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      wrap.appendChild(form);
      openModal('Attiva la verifica in due passaggi', wrap);
    });
  }

  views.security = async (root) => {
    const info = await api('/security');
    root.innerHTML = '';
    root.appendChild(el('<div class="view-header"><h2>Sicurezza</h2></div>'));

    const block = el('<div class="section-block"><h3>Verifica in due passaggi</h3></div>');

    if (!info.totpEnabled) {
      block.appendChild(el(`
        <p class="card-sub">Non attiva: per entrare basta la password. Attivandola servira' anche
        un codice a 6 cifre generato dal telefono, che cambia ogni 30 secondi.
        Funziona senza connessione a internet e senza inviare nulla a nessuno.</p>
      `));
      const btn = el('<button class="btn btn-primary">Attiva con QR</button>');
      btn.addEventListener('click', startTotpSetup);
      block.appendChild(btn);
    } else {
      block.appendChild(el(`
        <p class="card-sub">Attiva. All'accesso viene chiesto il codice dell'app di autenticazione.</p>
        <p class="card-sub">Codici di recupero ancora utilizzabili: <strong>${info.recoveryCodesLeft}</strong> su 8.</p>
      `));
      const actions = el('<div class="card-actions" style="padding:12px 0 0"></div>');

      const nuovi = el('<button class="btn btn-sm">Genera nuovi codici di recupero</button>');
      nuovi.addEventListener('click', () => {
        askPassword(
          'Nuovi codici di recupero',
          'I codici precedenti smetteranno di funzionare. Conferma con la tua password.',
          async (password) => {
            const res = await api('/security/totp/recovery-codes', {
              method: 'POST',
              body: JSON.stringify({ password }),
            });
            closeModal();
            showRecoveryCodes(res.recoveryCodes);
          }
        );
      });

      const off = el('<button class="btn btn-sm btn-danger">Disattiva</button>');
      off.addEventListener('click', () => {
        askPassword(
          'Disattiva la verifica in due passaggi',
          'Dopo la disattivazione per entrare bastera\' di nuovo la sola password. Conferma con la tua password.',
          async (password) => {
            await api('/security/totp/disable', { method: 'POST', body: JSON.stringify({ password }) });
            closeModal();
            toast('Verifica in due passaggi disattivata');
            render('security');
          }
        );
      });

      actions.appendChild(nuovi);
      actions.appendChild(off);
      block.appendChild(actions);

      if (info.recoveryCodesLeft === 0) {
        block.appendChild(el(`
          <p class="form-error">Hai finito i codici di recupero: se perdi il telefono non potrai
          piu' entrare dall'app. Generane di nuovi.</p>
        `));
      }
    }

    root.appendChild(block);

    const help = el('<div class="section-block"><h3>Se perdi il telefono</h3></div>');
    help.appendChild(el(`
      <p class="card-sub">Usa uno dei codici di recupero al posto delle 6 cifre nella schermata di accesso.
      Se non hai nemmeno quelli, dal computer dove gira Mindkeep puoi disattivare la verifica con:</p>
      <p><code class="cmd-line">docker compose exec mindkeep node server/disable-2fa.js</code></p>
    `));
    root.appendChild(help);
  };

  // ---------------- Global search ----------------
  const searchInput = document.getElementById('global-search');
  const searchResults = document.getElementById('search-results');
  const topbar = document.getElementById('topbar');
  const searchToggle = document.getElementById('search-toggle');
  let searchTimer = null;

  // Su telefono la ricerca sta dietro un'icona: apre a tutta larghezza al tocco
  // e libera lo spazio che occupava fissa in cima. Su schermo largo l'icona e'
  // nascosta dal CSS e il campo resta sempre visibile.
  searchToggle.innerHTML = icona('cerca');
  searchToggle.addEventListener('click', () => {
    const aperta = topbar.classList.toggle('search-open');
    searchToggle.setAttribute('aria-expanded', String(aperta));
    searchToggle.innerHTML = icona(aperta ? 'chiudi' : 'cerca');
    if (aperta) {
      searchInput.focus();
    } else {
      searchInput.value = '';
      searchResults.classList.add('hidden');
    }
  });

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

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
    if (appRoot.classList.contains('hidden')) return; // non ancora autenticati
    e.preventDefault();
    if (!topbar.classList.contains('search-open') && searchToggle.offsetParent) searchToggle.click();
    else searchInput.focus();
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
