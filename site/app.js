/*
 * Static site logic. No framework, no build step, no runtime dependency.
 *
 * The site reads the JSON files written by the publish stage: data/index.json
 * first, then one file per month. Item text always goes through textContent,
 * never innerHTML: titles come from third-party feeds and are treated as data.
 */

(function () {
  'use strict';

  const MAX_MONTHS = 12;
  const MAX_TAG_CHIPS = 20;

  const CRITICALITIES = ['blocking', 'impacting', 'background'];

  /*
   * Navigation. A scope with facets asks a second question before showing
   * anything; the others go straight to their items. A null category list means
   * "everything", and the Tout facet exists so the items that belong to neither
   * side of a scope stay reachable.
   */
  const PLATFORM_FACETS = [
    { key: 'os', label: 'Système', categories: ['os-release'] },
    { key: 'devices', label: 'Appareils', categories: ['hardware'] },
    { key: 'all', label: 'Tout', categories: null }
  ];

  const CONNECTIVITY_FACETS = [
    { key: 'ble', label: 'Bluetooth / BLE', categories: ['ble'] },
    { key: 'nfc', label: 'NFC', categories: ['nfc'] },
    { key: 'all', label: 'Tout', categories: null }
  ];

  const SCOPES = [
    { key: 'ios', label: 'iOS', categories: ['ios'], facets: PLATFORM_FACETS },
    { key: 'android', label: 'Android', categories: ['android'], facets: PLATFORM_FACETS },
    {
      key: 'connectivity',
      label: 'Connectivité',
      categories: ['ble', 'nfc'],
      facets: CONNECTIVITY_FACETS
    },
    { key: 'react-native', label: 'React Native', categories: ['react-native'], facets: null },
    { key: 'typescript', label: 'TypeScript', categories: ['typescript'], facets: null },
    { key: 'all', label: 'Tout', categories: null, facets: null }
  ];

  const CRITICALITY_LABELS = {
    blocking: 'Bloquant',
    impacting: 'Impactant',
    background: 'Veille'
  };

  const TRUST_LABELS = {
    verified: 'Vérifié',
    reported: 'Officiel, citation non vérifiée',
    unverified: 'Non vérifié'
  };

  const CATEGORY_LABELS = {
    'react-native': 'React Native',
    typescript: 'TypeScript',
    ios: 'iOS',
    android: 'Android',
    background: 'Arrière-plan',
    ble: 'Bluetooth / BLE',
    hardware: 'Matériel',
    tooling: 'Outillage',
    policy: 'Règles de store',
    'os-release': 'Systèmes',
    nfc: 'NFC'
  };

  const DENSITY_KEY = 'veille-density';
  const DENSITY_COMPACT = 'compact';
  const DENSITY_DETAIL = 'detail';

  const state = {
    items: [],
    index: null,
    projectLabels: {},
    query: '',
    categories: new Set(),
    tags: new Set(),
    onlyUnverified: false,
    density: DENSITY_COMPACT,
    scope: null,
    facet: null
  };

  /**
   * Reading a stored preference must never break the page. Detail is the
   * default: hiding the summaries from a first visitor would hide the point of
   * the site, and compact stays one click away.
   */
  function readStoredDensity() {
    try {
      return localStorage.getItem(DENSITY_KEY) === DENSITY_COMPACT
        ? DENSITY_COMPACT
        : DENSITY_DETAIL;
    } catch {
      return DENSITY_DETAIL;
    }
  }

  function storeDensity(density) {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // A private window refuses storage; the preference is simply not kept.
    }
  }

  /* ---------- helpers ---------- */

  function byId(id) {
    return document.getElementById(id);
  }

  /** Accent-insensitive lower case, so "resume" matches "résumé". */
  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function formatDate(isoDate) {
    const parsed = new Date(isoDate);

    if (isNaN(parsed.getTime())) {
      return '';
    }

    return parsed.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
  }

  function projectLabel(code) {
    return state.projectLabels[code] || code;
  }

  /** Only http(s) links are ever rendered, whatever the data claims. */
  function isSafeUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }

    return element;
  }

  function createBadge(className, text) {
    return createElement('span', 'badge ' + className, text);
  }

  function createPillList(values, toLabel) {
    const list = createElement('ul', 'pills');

    for (let index = 0; index < values.length; index += 1) {
      list.appendChild(createElement('li', null, toLabel(values[index])));
    }

    return list;
  }

  /* ---------- rendering ---------- */

  let cardSequence = 0;

  function createCard(item) {
    const card = createElement('article', 'card card--' + item.criticality);
    const accent = createElement('div', 'card-accent');
    accent.setAttribute('aria-hidden', 'true');
    card.appendChild(accent);

    const main = createElement('div', 'card-main');
    const badges = createElement('div', 'card-badges');

    badges.appendChild(
      createBadge('badge--' + item.criticality, CRITICALITY_LABELS[item.criticality] || item.criticality)
    );
    badges.appendChild(
      createBadge('badge--' + item.trustLevel, TRUST_LABELS[item.trustLevel] || item.trustLevel)
    );

    if (item.deadline) {
      badges.appendChild(createBadge('badge--deadline', 'Échéance ' + item.deadline));
    }

    main.appendChild(badges);

    const heading = createElement('h3');

    if (isSafeUrl(item.sourceUrl)) {
      const link = createElement('a', null, item.title);
      link.href = item.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      heading.appendChild(link);
    } else {
      heading.textContent = item.title;
    }

    main.appendChild(heading);

    const body = createElement('div', 'card-body');
    cardSequence += 1;
    body.id = 'card-body-' + cardSequence;

    if (item.summary) {
      body.appendChild(createElement('p', 'summary', item.summary));
    }

    if (item.evidenceQuote && item.trustLevel === 'verified') {
      body.appendChild(createElement('blockquote', 'evidence', '« ' + item.evidenceQuote + ' »'));
    }

    if (item.verificationNote) {
      body.appendChild(createElement('p', 'note', item.verificationNote));
    }

    const meta = createElement('ul', 'meta');
    meta.appendChild(createElement('li', null, item.sourceName));

    const published = formatDate(item.publishedAt);

    if (published) {
      meta.appendChild(createElement('li', null, published));
    }

    if (item.categories && item.categories.length > 0) {
      meta.appendChild(createElement('li', null, item.categories.map(categoryLabel).join(' · ')));
    }

    body.appendChild(meta);

    if (item.tags && item.tags.length > 0) {
      body.appendChild(
        createPillList(item.tags, function (tag) {
          return '#' + tag;
        })
      );
    }

    if (item.impactedProjects && item.impactedProjects.length > 0) {
      body.appendChild(createPillList(item.impactedProjects, projectLabel));
    }

    main.appendChild(body);

    const toggle = createElement('button', 'card-toggle', 'Détails');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', body.id);

    toggle.addEventListener('click', function () {
      const opened = card.getAttribute('data-open') === '1';
      card.setAttribute('data-open', opened ? '0' : '1');
      toggle.setAttribute('aria-expanded', String(!opened));
      toggle.textContent = opened ? 'Détails' : 'Replier';
    });

    main.appendChild(toggle);
    card.appendChild(main);

    return card;
  }

  function matchesFilters(item) {
    if (state.onlyUnverified && item.trustLevel !== 'unverified') {
      return false;
    }

    if (state.categories.size > 0) {
      let hasCategory = false;

      for (let index = 0; index < item.categories.length; index += 1) {
        if (state.categories.has(item.categories[index])) {
          hasCategory = true;
          break;
        }
      }

      if (!hasCategory) {
        return false;
      }
    }

    if (state.tags.size > 0) {
      let hasTag = false;

      for (let tagIndex = 0; tagIndex < item.tags.length; tagIndex += 1) {
        if (state.tags.has(item.tags[tagIndex])) {
          hasTag = true;
          break;
        }
      }

      if (!hasTag) {
        return false;
      }
    }

    if (state.query.length === 0) {
      return true;
    }

    return item.haystack.indexOf(state.query) >= 0;
  }

  function render() {
    const scoped = state.scope === null ? [] : itemsIn(state.scope, state.facet);
    const visible = scoped.filter(matchesFilters);
    let total = 0;

    for (let index = 0; index < CRITICALITIES.length; index += 1) {
      const criticality = CRITICALITIES[index];
      const section = byId('section-' + criticality);
      const container = byId('items-' + criticality);
      const counter = byId('count-' + criticality);
      const items = visible.filter(function (item) {
        return item.criticality === criticality;
      });

      container.textContent = '';

      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        container.appendChild(createCard(items[itemIndex]));
      }

      counter.textContent = items.length + (items.length === 1 ? ' item' : ' items');
      container.setAttribute('data-density', state.density);
      section.hidden = items.length === 0;
      total += items.length;
    }

    byId('empty').hidden = total > 0 || scoped.length === 0;
    byId('match-count').textContent =
      total === scoped.length ? total + ' item(s)' : total + ' sur ' + scoped.length + ' item(s)';
  }

  function findScope(key) {
    for (let index = 0; index < SCOPES.length; index += 1) {
      if (SCOPES[index].key === key) {
        return SCOPES[index];
      }
    }

    return null;
  }

  function findFacet(scope, key) {
    if (scope === null || scope.facets === null) {
      return null;
    }

    for (let index = 0; index < scope.facets.length; index += 1) {
      if (scope.facets[index].key === key) {
        return scope.facets[index];
      }
    }

    return null;
  }

  /** A null list matches everything; otherwise any one category is enough. */
  function hasAnyCategory(item, categories) {
    if (categories === null) {
      return true;
    }

    const own = item.categories || [];

    for (let index = 0; index < categories.length; index += 1) {
      if (own.indexOf(categories[index]) >= 0) {
        return true;
      }
    }

    return false;
  }

  /** Items belonging to a scope, and to a facet of it when one is selected. */
  function itemsIn(scopeKey, facetKey) {
    const scope = findScope(scopeKey);

    if (scope === null) {
      return [];
    }

    const facet = facetKey === null ? null : findFacet(scope, facetKey);

    return state.items.filter(function (item) {
      if (!hasAnyCategory(item, scope.categories)) {
        return false;
      }

      return facet === null || hasAnyCategory(item, facet.categories);
    });
  }

  function countCriticalities(items) {
    const counts = { blocking: 0, impacting: 0, background: 0 };

    for (let index = 0; index < items.length; index += 1) {
      const criticality = items[index].criticality;

      if (counts[criticality] !== undefined) {
        counts[criticality] += 1;
      }
    }

    return counts;
  }

  /** The three coloured counters carried by every navigation card. */
  function createDeckBadges(counts) {
    const wrapper = createElement('span', 'deck-badges');

    for (let index = 0; index < CRITICALITIES.length; index += 1) {
      const criticality = CRITICALITIES[index];
      const badge = createElement('span', 'deck-badge deck-badge--' + criticality);
      badge.appendChild(createElement('span', 'deck-badge-value', counts[criticality]));
      badge.appendChild(
        createElement(
          'span',
          'visually-hidden',
          ' ' + (CRITICALITY_LABELS[criticality] || criticality)
        )
      );
      wrapper.appendChild(badge);
    }

    return wrapper;
  }

  function createDeckCard(href, label, items, note) {
    const card = createElement('a', 'deck-card');
    card.href = href;
    card.appendChild(createElement('span', 'deck-title', label));

    if (note) {
      card.appendChild(createElement('span', 'deck-note', note));
    }

    card.appendChild(createDeckBadges(countCriticalities(items)));
    card.appendChild(createElement('span', 'deck-total', items.length + ' item(s)'));

    return card;
  }

  function renderHome() {
    const deck = byId('home-deck');
    deck.textContent = '';

    for (let index = 0; index < SCOPES.length; index += 1) {
      const scope = SCOPES[index];
      const items = itemsIn(scope.key, null);
      const note =
        scope.facets === null
          ? null
          : scope.facets
              .slice(0, 2)
              .map(function (facet) {
                return facet.label;
              })
              .join(' ou ');
      deck.appendChild(createDeckCard('#/' + scope.key, scope.label, items, note));
    }
  }

  function renderFacets(scopeKey) {
    const scope = findScope(scopeKey);
    const deck = byId('facets-deck');
    deck.textContent = '';
    byId('facets-title').textContent = scope === null ? '' : scope.label;

    if (scope === null || scope.facets === null) {
      return;
    }

    for (let index = 0; index < scope.facets.length; index += 1) {
      const facet = scope.facets[index];
      deck.appendChild(
        createDeckCard(
          '#/' + scopeKey + '/' + facet.key,
          facet.label,
          itemsIn(scopeKey, facet.key),
          null
        )
      );
    }
  }

  function renderBreadcrumb() {
    const nav = byId('breadcrumb');
    nav.textContent = '';

    if (state.scope === null) {
      nav.hidden = true;

      return;
    }

    const home = createElement('a', null, 'Accueil');
    home.href = '#/';
    nav.appendChild(home);

    const scope = findScope(state.scope);

    if (scope !== null && state.facet !== null) {
      nav.appendChild(createElement('span', 'breadcrumb-sep', '/'));
      const scopeLink = createElement('a', null, scope.label);
      scopeLink.href = '#/' + scope.key;
      nav.appendChild(scopeLink);
    }

    const facet = state.facet === null ? null : findFacet(scope, state.facet);
    const current = facet !== null ? facet.label : scope === null ? '' : scope.label;
    nav.appendChild(createElement('span', 'breadcrumb-sep', '/'));
    nav.appendChild(createElement('span', 'breadcrumb-current', current));
    nav.hidden = false;
  }

  function renderStats() {
    const stats = byId('stats');
    stats.textContent = '';

    if (!state.index) {
      return;
    }

    const counts = state.index.counts;
    const entries = [
      ['Items', counts.total],
      ['Bloquants', counts.blocking],
      ['Non vérifiés', counts.unverified],
      ['Sources', state.index.feedCount]
    ];

    for (let index = 0; index < entries.length; index += 1) {
      const group = createElement('div');
      group.appendChild(createElement('dt', null, entries[index][0]));
      group.appendChild(createElement('dd', null, entries[index][1]));
      stats.appendChild(group);
    }
  }

  function renderFooter() {
    const note = byId('footer-note');

    if (!state.index) {
      note.textContent = '';

      return;
    }

    const collected = state.index.lastCollectedAt ? formatDate(state.index.lastCollectedAt) : null;
    note.textContent = collected
      ? 'Dernière collecte le ' + collected + '. Site généré automatiquement, sans relecture humaine.'
      : 'Site généré automatiquement, sans relecture humaine.';
  }

  /* ---------- filter chips ---------- */

  const chipRegistry = [];

  /** Re-reads every chip's pressed state from the filters themselves. */
  function syncChips() {
    for (let index = 0; index < chipRegistry.length; index += 1) {
      const entry = chipRegistry[index];
      const pressed = entry.value === null ? entry.bucket.size === 0 : entry.bucket.has(entry.value);
      entry.chip.setAttribute('aria-pressed', String(pressed));
    }
  }

  /**
   * A chip with a null value is the "all" chip: it clears its group. It exists
   * because the default state was otherwise only deducible from the absence of
   * any active chip.
   */
  function buildChip(row, value, label, bucket) {
    const chip = createElement('button', 'chip', label);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', 'false');

    if (value === null) {
      chip.classList.add('chip-all');
    }

    chip.addEventListener('click', function () {
      if (value === null) {
        bucket.clear();
      } else if (bucket.has(value)) {
        bucket.delete(value);
      } else {
        bucket.add(value);
      }

      syncChips();
      render();
    });

    chipRegistry.push({ chip: chip, value: value, bucket: bucket });
    row.appendChild(chip);
  }

  function countValues(getValues) {
    const counts = new Map();
    const scoped = state.scope === null ? [] : itemsIn(state.scope, state.facet);

    for (let index = 0; index < scoped.length; index += 1) {
      const values = getValues(scoped[index]) || [];

      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        const value = values[valueIndex];
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }

    return Array.from(counts.entries()).sort(function (left, right) {
      return right[1] - left[1] || String(left[0]).localeCompare(String(right[0]));
    });
  }

  function buildChips() {
    const categoryRow = byId('category-chips');
    const tagRow = byId('tag-chips');
    categoryRow.textContent = '';
    tagRow.textContent = '';
    chipRegistry.length = 0;

    buildChip(categoryRow, null, 'Toutes', state.categories);
    buildChip(tagRow, null, 'Tous', state.tags);

    const categories = countValues(function (item) {
      return item.categories;
    });

    for (let index = 0; index < categories.length; index += 1) {
      buildChip(categoryRow, categories[index][0], categoryLabel(categories[index][0]), state.categories);
    }

    const tags = countValues(function (item) {
      return item.tags;
    }).slice(0, MAX_TAG_CHIPS);

    for (let tagIndex = 0; tagIndex < tags.length; tagIndex += 1) {
      buildChip(tagRow, tags[tagIndex][0], '#' + tags[tagIndex][0], state.tags);
    }

    byId('category-fieldset').hidden = categories.length === 0;
    byId('tag-fieldset').hidden = tags.length === 0;
    syncChips();
  }

  /* ---------- data loading ---------- */

  function prepareItem(item) {
    item.haystack = fold(
      [
        item.title,
        item.summary,
        item.sourceName,
        item.verificationNote || '',
        (item.tags || []).join(' '),
        (item.categories || []).join(' ')
      ].join(' ')
    );

    return item;
  }

  function sortItems(left, right) {
    const byCriticality =
      CRITICALITIES.indexOf(left.criticality) - CRITICALITIES.indexOf(right.criticality);

    if (byCriticality !== 0) {
      return byCriticality;
    }

    return String(right.publishedAt).localeCompare(String(left.publishedAt));
  }

  function fetchJson(path) {
    return fetch(path).then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' on ' + path);
      }

      return response.json();
    });
  }

  /** The local project labels are optional by design: absent means codes. */
  function loadProjectLabels() {
    return fetchJson('projects.local.json')
      .then(function (labels) {
        state.projectLabels = labels || {};
      })
      .catch(function () {
        state.projectLabels = {};
      });
  }

  function loadMonths(index) {
    const months = index.months
      .map(function (month) {
        return month.month;
      })
      .sort()
      .reverse()
      .slice(0, MAX_MONTHS);

    return Promise.all(
      months.map(function (month) {
        return fetchJson('data/items/' + month + '.json').catch(function () {
          return { items: [] };
        });
      })
    );
  }

  function load() {
    const status = byId('status');

    return loadProjectLabels()
      .then(function () {
        return fetchJson('data/index.json');
      })
      .then(function (index) {
        state.index = index;

        return loadMonths(index);
      })
      .then(function (files) {
        const items = [];

        for (let index = 0; index < files.length; index += 1) {
          const monthItems = files[index].items || [];

          for (let itemIndex = 0; itemIndex < monthItems.length; itemIndex += 1) {
            items.push(prepareItem(monthItems[itemIndex]));
          }
        }

        state.items = items.sort(sortItems);
        status.hidden = true;
        renderStats();
        renderFooter();
        applyRoute();
      })
      .catch(function (error) {
        status.textContent =
          'Données indisponibles pour le moment. Le pipeline n’a peut-être pas encore publié. (' +
          error.message +
          ')';
      });
  }

  /* ---------- wiring ---------- */

  /** Reads `#/scope/facet` from the address bar. Anything unknown means home. */
  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(function (part) {
      return part.length > 0;
    });
    const scope = parts.length > 0 ? findScope(parts[0]) : null;

    if (scope === null) {
      return { scope: null, facet: null };
    }

    if (scope.facets === null) {
      return { scope: scope.key, facet: null };
    }

    const facet = parts.length > 1 ? findFacet(scope, parts[1]) : null;

    return { scope: scope.key, facet: facet === null ? null : facet.key };
  }

  /**
   * A faceted scope with no facet chosen shows the second question instead of a
   * list; every other route goes straight to the items.
   */
  function applyRoute() {
    const route = parseHash();
    state.scope = route.scope;
    state.facet = route.facet;

    const scope = state.scope === null ? null : findScope(state.scope);
    const showHome = scope === null;
    const showFacets = !showHome && scope.facets !== null && state.facet === null;
    const showList = !showHome && !showFacets;

    byId('home').hidden = !showHome;
    byId('facets').hidden = !showFacets;
    byId('list-view').hidden = !showList;
    byId('filters').hidden = !showList;

    renderBreadcrumb();

    if (showHome) {
      renderHome();
    } else if (showFacets) {
      renderFacets(state.scope);
    } else {
      state.query = '';
      byId('search').value = '';
      state.categories.clear();
      state.tags.clear();
      buildChips();
      render();
    }

    window.scrollTo(0, 0);
  }

  function applyDensityToToggle() {
    const toggle = byId('density-toggle');
    const detailed = state.density === DENSITY_DETAIL;
    toggle.setAttribute('aria-pressed', String(detailed));
    toggle.textContent = detailed ? 'Cartes dépliées' : 'Cartes repliées';
  }

  function wireFilters() {
    const search = byId('search');
    const onlyUnverified = byId('only-unverified');
    const density = byId('density-toggle');

    density.addEventListener('click', function () {
      state.density = state.density === DENSITY_DETAIL ? DENSITY_COMPACT : DENSITY_DETAIL;
      storeDensity(state.density);
      applyDensityToToggle();
      render();
    });

    search.addEventListener('input', function () {
      state.query = fold(search.value.trim());
      render();
    });

    onlyUnverified.addEventListener('change', function () {
      state.onlyUnverified = onlyUnverified.checked;
      render();
    });

    byId('filters').addEventListener('reset', function () {
      state.query = '';
      state.onlyUnverified = false;
      state.categories.clear();
      state.tags.clear();

      const chips = document.querySelectorAll('.chip');

      for (let index = 0; index < chips.length; index += 1) {
        chips[index].setAttribute('aria-pressed', 'false');
      }

      syncChips();
      window.setTimeout(render, 0);
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // An unavailable service worker only costs the offline mode.
      });
    });
  }

  state.density = readStoredDensity();
  wireFilters();
  applyDensityToToggle();
  window.addEventListener('hashchange', applyRoute);
  registerServiceWorker();
  load();
})();
