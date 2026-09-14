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
  const OS_CATEGORY = 'os-release';

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
    'os-release': 'Systèmes'
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
    density: DENSITY_COMPACT
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
    const visible = state.items.filter(matchesFilters);
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

    renderOsIndex(visible);
    byId('empty').hidden = total > 0 || state.items.length === 0;
    byId('match-count').textContent =
      total === state.items.length
        ? total + ' item(s)'
        : total + ' sur ' + state.items.length + ' item(s)';
  }

  /**
   * Compact index of the operating-system items: the point is to see at a
   * glance which release is current and which one it replaces. The full cards
   * stay in their criticality section, so nothing is hidden behind this view.
   */
  function renderOsIndex(visible) {
    const section = byId('section-os');
    const list = byId('items-os');
    const items = visible.filter(function (item) {
      return (item.categories || []).indexOf(OS_CATEGORY) >= 0;
    });

    list.textContent = '';

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const row = createElement('li', 'os-row');

      row.appendChild(
        createBadge('badge--' + item.criticality, CRITICALITY_LABELS[item.criticality] || item.criticality)
      );

      if (isSafeUrl(item.sourceUrl)) {
        const link = createElement('a', null, item.title);
        link.href = item.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        row.appendChild(link);
      } else {
        row.appendChild(createElement('span', null, item.title));
      }

      const published = formatDate(item.publishedAt);

      if (published) {
        row.appendChild(createElement('span', 'os-date', published));
      }

      list.appendChild(row);
    }

    byId('count-os').textContent = items.length + (items.length === 1 ? ' item' : ' items');
    section.hidden = items.length === 0;
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

    for (let index = 0; index < state.items.length; index += 1) {
      const values = getValues(state.items[index]) || [];

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
        buildChips();
        render();
      })
      .catch(function (error) {
        status.textContent =
          'Données indisponibles pour le moment. Le pipeline n’a peut-être pas encore publié. (' +
          error.message +
          ')';
      });
  }

  /* ---------- wiring ---------- */

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
  registerServiceWorker();
  load();
})();
