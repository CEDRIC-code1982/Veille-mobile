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
    policy: 'Règles de store'
  };

  const state = {
    items: [],
    index: null,
    projectLabels: {},
    query: '',
    categories: new Set(),
    tags: new Set(),
    onlyUnverified: false
  };

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

  function createCard(item) {
    const card = createElement('article', 'card card--' + item.criticality);
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

    card.appendChild(badges);

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

    card.appendChild(heading);

    if (item.summary) {
      card.appendChild(createElement('p', 'summary', item.summary));
    }

    if (item.evidenceQuote && item.trustLevel === 'verified') {
      card.appendChild(createElement('blockquote', 'evidence', '« ' + item.evidenceQuote + ' »'));
    }

    if (item.verificationNote) {
      card.appendChild(createElement('p', 'note', item.verificationNote));
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

    card.appendChild(meta);

    if (item.tags && item.tags.length > 0) {
      card.appendChild(
        createPillList(item.tags, function (tag) {
          return '#' + tag;
        })
      );
    }

    if (item.impactedProjects && item.impactedProjects.length > 0) {
      card.appendChild(createPillList(item.impactedProjects, projectLabel));
    }

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
      section.hidden = items.length === 0;
      total += items.length;
    }

    byId('empty').hidden = total > 0 || state.items.length === 0;
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

  function buildChip(row, value, label, bucket) {
    const chip = createElement('button', 'chip', label);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', 'false');

    chip.addEventListener('click', function () {
      if (bucket.has(value)) {
        bucket.delete(value);
        chip.setAttribute('aria-pressed', 'false');
      } else {
        bucket.add(value);
        chip.setAttribute('aria-pressed', 'true');
      }

      render();
    });

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

  function wireFilters() {
    const search = byId('search');
    const onlyUnverified = byId('only-unverified');

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

  wireFilters();
  registerServiceWorker();
  load();
})();
