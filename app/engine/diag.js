/* pwa-engine — diagnostic complet (page diag.html).
 *
 * Charge apres engine.js, uniquement par la page diag.html de l'app :
 *
 *   <body data-diag data-app-id="monapp" data-legacy="ancien_,vieux_">
 *   <script src="engine/engine.js"></script>
 *   <script src="engine/diag.js"></script>
 *
 * Lecture seule : rien n'est modifie ni envoye. Le rapport repond a « qu'est-ce
 * que cet appareil a reellement en memoire pour cette app, et est-ce coherent ? » :
 *   - RESUME : des verdicts (ok / a surveiller / probleme) lisibles d'un coup d'oeil ;
 *   - VERSIONS : HTML, script, service worker, manifest, caches et SW actif sont-ils
 *     de la meme version ? (detecte les etats « melanges » pendant une mise a jour) ;
 *   - PRECACHE : tous les fichiers de APP_SHELL sont-ils dans le cache ?
 *   - JOURNAL : historique des ouvertures, avec detection des disparitions de donnees ;
 *   - ERREURS : les dernieres erreurs JS capturees par le moteur ;
 *   - STOCKAGE, SERVICE WORKERS, CACHES, APPAREIL.
 *
 * Les fonctions pures (fmtBytes, versionIn, parseShell, checkVersions,
 * analyzeJournal) sont exposees sous AppEngine.diag pour etre testees sous Node.
 */
(function (global) {
  'use strict';

  var E = global.AppEngine;
  if (!E) return;

  /* -------------------------------------------- Fonctions pures (testables) */
  function fmtBytes(n) {
    if (typeof n !== 'number' || isNaN(n)) return '?';
    if (n < 1024) return n + ' o';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' Ko';
    return (n / 1048576).toFixed(1) + ' Mo';
  }

  var RE = {
    html: /<meta\s+name="app-version"\s+content="([^"]*)"/i,
    js: /APP_VERSION\s*=\s*['"]([^'"]+)['"]/,
    slug: /APP_SLUG\s*=\s*['"]([^'"]+)['"]/,
    engine: /ENGINE_VERSION\s*=\s*'([^']+)'/,
  };
  // Version lue dans le texte d'un fichier : kind = html | js | slug | engine | manifest.
  function versionIn(kind, text) {
    if (typeof text !== 'string') return null;
    if (kind === 'manifest') {
      try { var j = JSON.parse(text); return j && j.version ? String(j.version) : null; } catch (e) { return null; }
    }
    var m = RE[kind] && RE[kind].exec(text);
    return m ? m[1] : null;
  }
  // Liste des fichiers de la coque declaree dans service-worker.js.
  function parseShell(swText) {
    var m = /APP_SHELL\s*=\s*\[([\s\S]*?)\]/.exec(swText || '');
    if (!m) return [];
    var out = [], re = /['"]([^'"]+)['"]/g, x;
    while ((x = re.exec(m[1]))) out.push(x[1]);
    return out;
  }
  // found = { libelle: version | null } -> { ok, distinct, groups, missing }
  function checkVersions(found) {
    var groups = {}, missing = [];
    Object.keys(found).forEach(function (k) {
      var v = found[k];
      if (v == null) { missing.push(k); return; }
      (groups[v] || (groups[v] = [])).push(k);
    });
    var distinct = Object.keys(groups);
    return { ok: distinct.length <= 1, distinct: distinct, groups: groups, missing: missing };
  }

  function two(n) { return n < 10 ? '0' + n : String(n); }
  function shortTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return two(d.getDate()) + '/' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  function splitKeys(k) { return k ? String(k).split(',').filter(Boolean) : []; }

  // Journal des ouvertures -> { lines, flags }. flags = [{ level: 'bad'|'warn', text }].
  // Detecte : mises a jour, changement de mode, HTML/JS de versions differentes,
  // et surtout les cles qui DISPARAISSENT d'une ouverture a la suivante.
  function analyzeJournal(entries) {
    var lines = [], flags = [], prev = null;
    (entries || []).forEach(function (e) {
      var keys = splitKeys(e.k), notes = [];
      if (prev) {
        if (prev.v !== e.v) notes.push('mise à jour ' + prev.v + ' → ' + e.v);
        var pk = splitKeys(prev.k);
        var lost = pk.filter(function (x) { return keys.indexOf(x) < 0; });
        if (lost.length) {
          var all = keys.length === 0;
          var when = shortTime(prev.t) + ' et ' + shortTime(e.t)
            + (prev.v !== e.v ? ' (mise à jour ' + prev.v + ' → ' + e.v + ')' : '');
          if (all) {
            notes.push('TOUTES LES DONNÉES ABSENTES');
            flags.push({ level: 'bad', text: 'Effacement complet des données entre ' + when });
          } else {
            notes.push('clés disparues : ' + lost.join(', '));
            flags.push({ level: 'warn', text: 'Clés disparues (' + lost.join(', ') + ') entre ' + when
              + ' — peut venir de « Réinitialiser la progression »' });
          }
        }
        if (prev.m !== e.m) notes.push('mode ' + (e.m ? 'installé' : 'onglet'));
      }
      if (e.x) {
        notes.push('HTML/JS différents (' + e.x + ')');
        flags.push({ level: 'warn', text: 'HTML et script de versions différentes à l\'ouverture de ' + shortTime(e.t) + ' (' + e.x + ')' });
      }
      lines.push(shortTime(e.t) + ' | ' + (e.v || '?') + ' | ' + (e.m ? 'installée' : 'onglet')
        + (e.o === 0 ? ' | hors ligne' : '') + (e.c === 0 ? ' | sans SW' : '')
        + ' | ' + (keys.length ? keys.length + ' clé(s) : ' + keys.join(',') : 'AUCUNE clé')
        + (typeof e.b === 'number' ? ' (' + fmtBytes(e.b) + ')' : '')
        + (notes.length ? '  ← ' + notes.join(' ; ') : ''));
      prev = e;
    });
    return { lines: lines, flags: flags };
  }

  // Verdicts a partir des donnees collectees -> [{ level: 'ok'|'warn'|'bad'|'info', text }].
  function verdicts(d) {
    var v = [];
    function add(level, text) { v.push({ level: level, text: text }); }

    if (d.versions) {
      var cv = d.versions.check;
      if (cv.ok && cv.distinct.length === 1) add('ok', 'Versions cohérentes (' + cv.distinct[0] + ' partout : HTML, script, service worker, manifest, cache)');
      else if (cv.distinct.length > 1) {
        add('bad', 'Versions MÉLANGÉES : ' + cv.distinct.map(function (x) { return x + ' (' + cv.groups[x].join(', ') + ')'; }).join(' ≠ '));
      } else add('warn', 'Versions non vérifiables (fichiers illisibles : ' + cv.missing.join(', ') + ')');
      if (d.versions.engine && d.versions.engine.distinct.length > 1) {
        add('warn', 'Versions du moteur différentes : ' + d.versions.engine.distinct.join(' ≠ '));
      }
    }
    if (d.shell) {
      if (!d.shell.checked) add('warn', 'Précache non vérifiable (' + (d.shell.reason || 'service-worker.js illisible') + ')');
      else if (d.shell.missing.length) add('bad', 'Précache incomplet : ' + d.shell.missing.length + ' fichier(s) absent(s) du cache (' + d.shell.missing.slice(0, 6).join(', ') + (d.shell.missing.length > 6 ? ', …' : '') + ') — l\'appli risque de ne pas marcher hors ligne');
      else add('ok', 'Précache complet (' + d.shell.total + ' fichiers présents dans le cache)');
    }
    if (d.sw) {
      if (!d.sw.supported) add('warn', 'Service worker non pris en charge par ce navigateur');
      else if (!d.sw.registrations.length) add('warn', 'Aucun service worker enregistré (première ouverture, navigation privée, ou hors https)');
      else if (!d.sw.controller) add('warn', 'Cette page n\'est pas contrôlée par le service worker (normal à la toute première ouverture)');
      else add('ok', 'Service worker actif et contrôlant la page');
      if (d.sw.registrations.some(function (r) { return r.waiting; })) add('warn', 'Une nouvelle version est prête mais pas encore appliquée (elle s\'appliquera depuis l\'accueil)');
    }
    if (d.storage) {
      var s = d.storage;
      if (!s.writable) add('bad', 'Écriture dans localStorage IMPOSSIBLE (' + (s.writeError || 'erreur') + ') : la progression ne sera pas sauvegardée');
      else add('ok', 'Écriture dans localStorage possible');
      var prevMax = 0;
      (d.journal && d.journal.entries || []).forEach(function (e) { prevMax = Math.max(prevMax, splitKeys(e.k).length); });
      if (!s.own.length) {
        if (prevMax > 0) add('bad', 'AUCUNE donnée de l\'appli en mémoire alors que le journal en montre déjà ' + prevMax + ' clé(s) : elles ont été effacées');
        else add('info', 'Aucune donnée enregistrée pour l\'instant (normal avant la première partie)');
      } else add('ok', s.own.length + ' clé(s) de données de l\'appli en mémoire (' + fmtBytes(s.ownBytes) + ')');
      if (s.legacy.length) add('warn', 'Anciennes clés encore présentes : ' + s.legacy.map(function (x) { return x.name; }).join(', '));
      if (s.persisted === true) add('ok', 'Stockage persistant (protégé contre la purge automatique)');
      else if (s.persisted === false) add('warn', 'Stockage non persistant : le navigateur peut le purger s\'il manque d\'espace');
      if (s.estimate && s.estimate.quota && s.estimate.usage / s.estimate.quota > 0.8) add('warn', 'Espace de stockage presque plein (' + fmtBytes(s.estimate.usage) + ' sur ' + fmtBytes(s.estimate.quota) + ')');
    }
    if (d.journal) {
      d.journal.analysis.flags.forEach(function (f) { add(f.level, f.text); });
      if (!d.journal.entries.length) add('info', 'Journal des ouvertures vide (première ouverture avec cette version du moteur, ou stockage effacé)');
    }
    if (d.errors && d.errors.list.length) {
      var last = d.errors.list[d.errors.list.length - 1];
      add('warn', d.errors.list.length + ' erreur(s) JavaScript enregistrée(s) — dernière : « ' + last.m + ' » (' + shortTime(last.t) + ')');
    } else if (d.errors) add('ok', 'Aucune erreur JavaScript enregistrée');
    if (d.env) add('info', 'Mode : ' + d.env.display + (d.env.online ? ', en ligne' : ', HORS LIGNE'));
    return v;
  }

  /* ------------------------------------------------------- Collecte (navigateur) */
  // Texte tel que le SERVEUR le sert (ou null). Une page controlee par le service worker voit
  // ses fetch() passer par lui (cache d'abord) : sans URL unique on relirait le cache, pas le
  // serveur, et un decalage serveur/cache resterait invisible. Les reponses ainsi obtenues sont
  // rangees par le SW dans son cache « runtime » : cleanupProbes() les retire ensuite.
  function get(url) {
    var probe = url + (url.indexOf('?') < 0 ? '?' : '&') + 'diag=' + Date.now() + Math.floor(Math.random() * 1000);
    return fetch(probe, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .catch(function () { return null; });
  }
  async function cleanupProbes() {
    try {
      if (!global.caches) return;
      var names = await global.caches.keys();
      for (var i = 0; i < names.length; i++) {
        var c = await global.caches.open(names[i]);
        var reqs = await c.keys();
        for (var j = 0; j < reqs.length; j++) if (/[?&]diag=\d+/.test(reqs[j].url)) await c.delete(reqs[j]);
      }
    } catch (e) { /* ignore */ }
  }
  function readList(k) {
    try { var v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  async function collectEnv() {
    var nav = global.navigator;
    var mq = function (q) { try { return global.matchMedia(q).matches; } catch (e) { return false; } };
    var display = ['standalone', 'fullscreen', 'minimal-ui'].filter(function (m) { return mq('(display-mode: ' + m + ')'); })[0]
      || (nav.standalone === true ? 'standalone (iOS)' : 'onglet du navigateur');
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    var c = nav.connection || {};
    return {
      time: new Date().toString(), tz: tz, ua: nav.userAgent, lang: nav.language, platform: nav.platform,
      display: display, online: nav.onLine !== false,
      screen: (global.screen ? global.screen.width + '×' + global.screen.height : '?') + ' @' + (global.devicePixelRatio || 1) + 'x',
      viewport: global.innerWidth + '×' + global.innerHeight,
      connection: c.effectiveType ? c.effectiveType + (c.saveData ? ' (économie de données)' : '') : 'inconnue',
      memory: nav.deviceMemory ? nav.deviceMemory + ' Go' : 'inconnue', cores: nav.hardwareConcurrency || '?',
      cookies: nav.cookieEnabled, visibility: document.visibilityState, referrer: document.referrer || '(aucun)',
      engine: E.version, url: global.location.href,
    };
  }

  async function collectStorage(id, legacy) {
    var s = { writable: true, own: [], internal: [], ownBytes: 0, legacy: [], others: [], diag: [], total: 0, totalBytes: 0 };
    try {
      localStorage.setItem('diag:probe', '1');
      s.writable = localStorage.getItem('diag:probe') === '1';
      localStorage.removeItem('diag:probe');
    } catch (e) { s.writable = false; s.writeError = String(e && e.message || e); }
    var p = id + ':';
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), raw = localStorage.getItem(k) || '', size = k.length + raw.length;
        s.total += 1; s.totalBytes += size;
        if (k.indexOf(p) === 0) {
          var name = k.slice(p.length), json = true;
          try { JSON.parse(raw); } catch (e2) { json = false; }
          var item = { name: name, size: size, json: json, preview: raw.length > 300 ? raw.slice(0, 300) + ' … (tronqué)' : raw };
          if (name.indexOf('__') === 0) s.internal.push(item);    // __schema, __legacy : internes au moteur
          else { s.own.push(item); s.ownBytes += size; }
        } else if (k.indexOf('diag:') === 0) s.diag.push({ name: k, size: size });
        else if ((legacy || []).some(function (lp) { return lp && k.indexOf(lp) === 0; })) s.legacy.push({ name: k, size: size, preview: raw.length > 200 ? raw.slice(0, 200) + ' …' : raw });
        else s.others.push({ name: k, size: size });
      }
    } catch (e3) { s.readError = String(e3 && e3.message || e3); }
    var nav = global.navigator;
    try {
      if (nav.storage && nav.storage.persisted) s.persisted = await nav.storage.persisted();
      if (nav.storage && nav.storage.estimate) s.estimate = await nav.storage.estimate();
    } catch (e4) { /* ignore */ }
    return s;
  }

  async function collectSw() {
    var out = { supported: !!(global.navigator && global.navigator.serviceWorker), registrations: [], controller: null };
    if (!out.supported) return out;
    var sw = global.navigator.serviceWorker;
    out.controller = sw.controller ? sw.controller.scriptURL : null;
    var regs = await sw.getRegistrations();
    out.registrations = regs.map(function (r) {
      var f = function (w) { return w ? { url: w.scriptURL, state: w.state } : null; };
      return { scope: r.scope, active: f(r.active), waiting: f(r.waiting), installing: f(r.installing), updateViaCache: r.updateViaCache };
    });
    return out;
  }

  async function collectCaches(names) {
    var out = { supported: !!global.caches, list: [] };
    if (!out.supported) return out;
    var keys = await global.caches.keys();
    for (var i = 0; i < keys.length; i++) {
      var c = await global.caches.open(keys[i]), reqs = await c.keys(), size = 0, counted = 0;
      for (var j = 0; j < reqs.length && j < 80; j++) {
        try { var r = await c.match(reqs[j]); if (r) { size += (await r.clone().blob()).size; counted += 1; } } catch (e) { /* ignore */ }
      }
      out.list.push({ name: keys[i], count: reqs.length, size: size, partial: reqs.length > counted });
    }
    return out;
  }

  // Versions dans les fichiers (reseau ET cache du SW) + coherence + precache.
  async function collectVersions(errors) {
    var out = { found: {}, check: null, engine: null, cacheName: null, slug: null, swVersion: null };
    var swText = await get('service-worker.js');
    out.slug = versionIn('slug', swText);
    out.swVersion = versionIn('js', swText);
    var name = out.slug && out.swVersion ? out.slug + '-' + out.swVersion : null;
    var hasCurrent = false;
    try { hasCurrent = !!(name && global.caches && await global.caches.has(name)); } catch (e) { /* ignore */ }
    out.cacheName = hasCurrent ? name : null;
    async function fromCache(url) {
      if (!global.caches) return null;
      try {
        var r = hasCurrent ? await (await global.caches.open(name)).match(url) : await global.caches.match(url);
        return r ? await r.text() : null;
      } catch (e) { return null; }
    }
    var htmlNet = await get('index.html'), htmlCache = await fromCache('index.html');
    var jsNet = await get('app.js'), jsCache = await fromCache('app.js');
    var maniNet = await get('manifest.json');
    var engNet = await get('engine/engine.js'), engCache = await fromCache('engine/engine.js');
    out.found = {
      'index.html (réseau)': versionIn('html', htmlNet),
      'index.html (cache)': versionIn('html', htmlCache),
      'app.js (réseau)': versionIn('js', jsNet),
      'app.js (cache)': versionIn('js', jsCache),
      'service-worker.js (réseau)': out.swVersion,
      'manifest.json (réseau)': versionIn('manifest', maniNet),
    };
    try {
      var reg = global.navigator.serviceWorker && await global.navigator.serviceWorker.getRegistration();
      var act = reg && reg.active && reg.active.scriptURL;
      var m = act && /[?&]v=([^&]+)/.exec(act);
      if (m) out.found['service worker actif (?v=)'] = decodeURIComponent(m[1]);
    } catch (e) { /* ignore */ }
    if (name) out.found['nom du cache'] = hasCurrent ? out.swVersion : null;
    // Les fichiers absents du reseau/cache (hors ligne, jamais mis en cache) ne comptent pas comme
    // « version differente » : ils sont listes a part.
    out.check = checkVersions(out.found);
    out.engine = checkVersions({ 'engine.js (réseau)': versionIn('engine', engNet), 'engine.js (cache)': versionIn('engine', engCache), 'moteur chargé': E.version });
    out.swText = swText;
    if (swText == null) errors.push('service-worker.js illisible (hors ligne ?)');
    return out;
  }

  async function collectShell(swText, cacheName) {
    if (swText == null) return { checked: false, reason: 'service-worker.js illisible' };
    var shell = parseShell(swText);
    if (!shell.length) return { checked: false, reason: 'APP_SHELL introuvable' };
    if (!global.caches) return { checked: false, reason: 'API caches absente' };
    var missing = [], cache = null;
    try { cache = cacheName ? await global.caches.open(cacheName) : null; } catch (e) { cache = null; }
    for (var i = 0; i < shell.length; i++) {
      var hit = null;
      try { hit = cache ? await cache.match(shell[i]) : await global.caches.match(shell[i]); } catch (e2) { hit = null; }
      if (!hit) missing.push(shell[i]);
    }
    return { checked: true, total: shell.length, missing: missing, cacheName: cacheName };
  }

  async function collect(opts) {
    opts = opts || {};
    var id = opts.id || 'app', errors = [], d = { id: id, errors_collect: errors };
    async function step(label, fn) {
      try { return await fn(); } catch (e) { errors.push(label + ' : ' + (e && e.message || e)); return null; }
    }
    d.env = await step('appareil', collectEnv);
    d.storage = await step('stockage', function () { return collectStorage(id, opts.legacy); });
    d.sw = await step('service workers', collectSw);
    d.caches = await step('caches', function () { return collectCaches(); });
    d.versions = await step('versions', function () { return collectVersions(errors); });
    d.shell = await step('précache', function () { return collectShell(d.versions && d.versions.swText, d.versions && d.versions.cacheName); });
    // Journaux : la cle par appli, plus l'ancien journal partage (avant le moteur 1.2.0)
    var entries = readList('diag:log:' + id).slice();
    var old = readList('diag:log').filter(function (e) { return e && e.a === id; });
    entries = old.concat(entries);
    d.journal = { entries: entries, analysis: analyzeJournal(entries) };
    d.errors = { list: readList('diag:errors:' + id) };
    await cleanupProbes();
    d.verdicts = verdicts(d);
    return d;
  }

  // Verifie s'il y a une nouvelle version cote serveur (action manuelle).
  async function checkUpdate() {
    var sw = global.navigator.serviceWorker;
    if (!sw) return 'Service worker non pris en charge.';
    var reg = await sw.getRegistration();
    if (!reg) return 'Aucun service worker enregistré.';
    await reg.update();
    await new Promise(function (r) { setTimeout(r, 1800); });
    var w = reg.installing || reg.waiting;
    return w ? 'Nouvelle version détectée (' + w.scriptURL + ', état : ' + w.state + ').'
      : 'Aucune nouvelle version : l\'appli est à jour (SW actif : ' + (reg.active ? reg.active.scriptURL : '?') + ').';
  }

  /* ---------------------------------------------------------------- Rendu texte */
  var ICON = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
  function kv(label, value) { return '  ' + label + ' : ' + value; }

  function toText(d) {
    var L = [];
    L.push('DIAGNOSTIC — ' + d.id + '   (moteur ' + (d.env ? d.env.engine : E.version) + ')');
    L.push('');
    L.push('== RÉSUMÉ ==');
    (d.verdicts || []).forEach(function (x) { L.push(ICON[x.level] + ' ' + x.text); });
    if (d.manual) { L.push(''); L.push('Vérification manuelle des mises à jour : ' + d.manual); }

    if (d.versions) {
      L.push(''); L.push('== VERSIONS ==');
      Object.keys(d.versions.found).forEach(function (k) { L.push(kv(k, d.versions.found[k] == null ? '(illisible / absent)' : d.versions.found[k])); });
      if (d.versions.engine) {
        Object.keys(d.versions.engine.groups).forEach(function (v) { L.push(kv('moteur ' + v, d.versions.engine.groups[v].join(', '))); });
      }
      if (d.versions.cacheName) L.push(kv('cache courant', d.versions.cacheName));
    }
    if (d.shell && d.shell.checked) {
      L.push(''); L.push('== PRÉCACHE (APP_SHELL) ==');
      L.push(kv('fichiers attendus', d.shell.total + ', absents du cache : ' + (d.shell.missing.length ? d.shell.missing.join(', ') : 'aucun')));
    }
    if (d.journal) {
      L.push(''); L.push('== JOURNAL DES OUVERTURES (les plus récentes en bas) ==');
      L.push('heure | version | mode | état | clés présentes à l\'ouverture');
      if (!d.journal.analysis.lines.length) L.push('(vide)');
      d.journal.analysis.lines.forEach(function (x) { L.push(x); });
    }
    if (d.errors) {
      L.push(''); L.push('== ERREURS JAVASCRIPT RÉCENTES ==');
      if (!d.errors.list.length) L.push('(aucune)');
      d.errors.list.forEach(function (e) { L.push(shortTime(e.t) + ' | ' + (e.v || '?') + ' | ' + e.m + (e.n > 1 ? ' (×' + e.n + ')' : '') + (e.s ? ' | ' + e.s : '')); });
    }
    if (d.storage) {
      var s = d.storage;
      L.push(''); L.push('== STOCKAGE ==');
      L.push(kv('localStorage (origine)', s.total + ' clé(s), ' + fmtBytes(s.totalBytes)));
      if (s.estimate) L.push(kv('espace utilisé', fmtBytes(s.estimate.usage) + ' sur ' + fmtBytes(s.estimate.quota)));
      L.push(kv('persistant', String(s.persisted)));
      L.push('-- données de l\'appli (' + d.id + ':) --');
      if (!s.own.length) L.push('(aucune)');
      s.own.forEach(function (x) { L.push(kv(x.name, x.size + ' o' + (x.json ? '' : ' [JSON ILLISIBLE]') + ' = ' + x.preview)); });
      if (s.internal.length) L.push('-- clés internes du moteur : ' + s.internal.map(function (x) { return x.name + '=' + x.preview; }).join(', ') + ' --');
      if (s.legacy.length) {
        L.push('-- anciennes clés encore présentes --');
        s.legacy.forEach(function (x) { L.push(kv(x.name, x.size + ' o = ' + x.preview)); });
      }
      L.push('-- autres clés de l\'origine (noms seulement, valeurs non affichées) : ' + s.others.length + ' --');
      s.others.forEach(function (x) { L.push('  ' + x.name + ' (' + x.size + ' o)'); });
      if (s.diag.length) L.push('-- journaux : ' + s.diag.map(function (x) { return x.name + ' ' + fmtBytes(x.size); }).join(', ') + ' --');
    }
    if (d.sw) {
      L.push(''); L.push('== SERVICE WORKERS ==');
      L.push(kv('page contrôlée par', d.sw.controller || '(personne)'));
      if (!d.sw.registrations.length) L.push('(aucun enregistrement)');
      d.sw.registrations.forEach(function (r) {
        L.push('  ' + r.scope);
        ['active', 'waiting', 'installing'].forEach(function (st) { if (r[st]) L.push('    ' + st + ' : ' + r[st].url + ' (' + r[st].state + ')'); });
        L.push('    updateViaCache : ' + r.updateViaCache);
      });
    }
    if (d.caches && d.caches.supported) {
      L.push(''); L.push('== CACHES ==');
      if (!d.caches.list.length) L.push('(aucun)');
      d.caches.list.forEach(function (c) { L.push(kv(c.name, c.count + ' fichier(s), ' + fmtBytes(c.size) + (c.partial ? '+' : ''))); });
    }
    if (d.env) {
      var e = d.env;
      L.push(''); L.push('== APPAREIL ET NAVIGATEUR ==');
      L.push(kv('heure', e.time)); L.push(kv('fuseau', e.tz)); L.push(kv('adresse', e.url));
      L.push(kv('mode', e.display)); L.push(kv('en ligne', String(e.online))); L.push(kv('connexion', e.connection));
      L.push(kv('navigateur', e.ua)); L.push(kv('plateforme / langue', e.platform + ' / ' + e.lang));
      L.push(kv('écran / fenêtre', e.screen + ' / ' + e.viewport)); L.push(kv('mémoire / cœurs', e.memory + ' / ' + e.cores));
      L.push(kv('cookies', String(e.cookies))); L.push(kv('visibilité', e.visibility)); L.push(kv('origine du lancement', e.referrer));
    }
    if (d.errors_collect && d.errors_collect.length) {
      L.push(''); L.push('== ÉTAPES DU DIAGNOSTIC EN ÉCHEC =='); d.errors_collect.forEach(function (x) { L.push('  ' + x); });
    }
    return L.join('\n');
  }

  /* --------------------------------------------------------------- Page (DOM) */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function page(opts) {
    var out = document.getElementById('out'), sum = document.getElementById('summary');
    var data = null, text = '';
    function el(id) { return document.getElementById(id); }
    function render() {
      text = toText(data);
      if (sum) {
        sum.innerHTML = '';
        data.verdicts.forEach(function (x) {
          var li = document.createElement('li');
          li.className = x.level;
          li.textContent = ICON[x.level] + ' ' + x.text;
          sum.appendChild(li);
        });
      }
      if (out) out.textContent = text;
    }
    async function refresh() {
      if (out) out.textContent = 'Analyse en cours…';
      try { data = await collect(opts); render(); }
      catch (e) { if (out) out.textContent = 'Le diagnostic a échoué : ' + (e && e.message || e); }
    }
    function label(btn, msg) { if (btn) { var old = btn.getAttribute('data-label') || btn.textContent; btn.setAttribute('data-label', old); btn.textContent = msg; setTimeout(function () { btn.textContent = old; }, 2200); } }

    if (el('copy')) el('copy').addEventListener('click', function () {
      var b = this;
      var done = function (ok) { label(b, ok ? 'Copié ✓' : 'Copie impossible : sélectionne le texte'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
      else done(fallbackCopy(text));
    });
    if (el('share') && navigator.share) {
      el('share').hidden = false;
      el('share').addEventListener('click', function () { navigator.share({ title: 'Diagnostic ' + opts.id, text: text }).catch(function () { /* annule */ }); });
    }
    if (el('save')) el('save').addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = 'diagnostic-' + opts.id + '-' + new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '') + '.txt';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
    if (el('refresh')) el('refresh').addEventListener('click', refresh);
    if (el('update-check')) el('update-check').addEventListener('click', async function () {
      var b = this; b.disabled = true;
      try { if (data) { data.manual = await checkUpdate(); render(); } } catch (e) { if (data) { data.manual = 'échec : ' + (e && e.message || e); render(); } }
      b.disabled = false;
    });
    return refresh();
  }

  function autoInit() {
    var b = document.body;
    if (!b || !b.hasAttribute || !b.hasAttribute('data-diag')) return;
    var legacy = (b.getAttribute('data-legacy') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    page({ id: b.getAttribute('data-app-id') || 'app', legacy: legacy });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
    else autoInit();
  }

  E.diag = {
    fmtBytes: fmtBytes, versionIn: versionIn, parseShell: parseShell, checkVersions: checkVersions,
    analyzeJournal: analyzeJournal, verdicts: verdicts, toText: toText,
    collect: collect, checkUpdate: checkUpdate, page: page,
  };
})(typeof window !== 'undefined' ? window : this);
