/*
 * Service worker: makes the site readable offline.
 *
 * The shell is precached at install. Data files are served cache-first, as
 * specified, with a background refresh so the next visit is up to date: on a
 * phone in a lift, showing yesterday's watch beats showing an error.
 */

'use strict';

const CACHE_NAME = 'veille-mobile-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(SHELL_ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function () {
        // A missing asset must not block the installation.
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            return name === CACHE_NAME ? Promise.resolve(false) : caches.delete(name);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function refreshInBackground(cache, request) {
  fetch(request)
    .then(function (response) {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
    })
    .catch(function () {
      // Offline: the cached copy stays as it is.
    });
}

function cacheFirst(request, revalidate) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) {
        if (revalidate) {
          refreshInBackground(cache, request);
        }

        return cached;
      }

      return fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }

          return response;
        })
        .catch(function () {
          return cache.match('./index.html').then(function (fallback) {
            if (fallback) {
              return fallback;
            }

            return new Response('Hors ligne et rien en cache.', {
              status: 503,
              headers: { 'content-type': 'text/plain; charset=utf-8' }
            });
          });
        });
    });
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  const isData = url.pathname.indexOf('/data/') >= 0 || /\.json$/.test(url.pathname);
  event.respondWith(cacheFirst(request, isData));
});
