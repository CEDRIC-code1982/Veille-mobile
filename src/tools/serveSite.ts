/**
 * Minimal static server for the local preview, built on `node:http` alone.
 *
 * Development only: it exists so the site can be checked in a browser exactly
 * as GitHub Pages will serve it, without adding a dependency or requiring any
 * other runtime on the machine.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { readIntegerEnv } from '../shared/env';
import { createLogger } from '../shared/logger';
import { PATHS } from '../shared/paths';
import { OUTPUT_DIRECTORY_NAME } from './buildSite';

const logger = createLogger(import.meta.url);

const DEFAULT_PORT = 8099;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

const root = resolve(join(PATHS.root, OUTPUT_DIRECTORY_NAME));

/** Resolves a request path inside the served root, refusing any escape. */
const resolveRequestPath = (requestUrl: string): string | undefined => {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const candidate = resolve(join(root, normalize(pathname)));

  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return undefined;
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    return join(candidate, 'index.html');
  }

  return candidate;
};

const server = createServer((request, response) => {
  const filePath = request.url === undefined ? undefined : resolveRequestPath(request.url);

  if (filePath === undefined || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');

    return;
  }

  // A Content-Length and a revalidating cache policy, rather than no-store:
  // some browsers refuse to install a service worker script otherwise.
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': statSync(filePath).size,
    'cache-control': 'no-cache',
  });
  createReadStream(filePath).pipe(response);
});

const port = readIntegerEnv('VEILLE_PREVIEW_PORT', DEFAULT_PORT);

server.listen(port, () => {
  logger.info(`preview available on http://localhost:${port}`);
});
