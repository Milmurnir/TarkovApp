'use strict';

/**
 * Local server for the packaged app.
 *
 * Serves the built frontend and proxies the upstreams, mirroring the Vite
 * dev proxy exactly. Loading the renderer over http://127.0.0.1 rather than
 * file:// means the app has a normal origin, so fetch, CORS and localStorage all
 * behave the same as they do in development and the frontend needs no changes.
 *
 * Bound to 127.0.0.1 on a fixed port (see startServer): nothing is exposed to
 * the network.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const UPSTREAMS = {
  '/api/wiki': { host: 'escapefromtarkov.fandom.com', path: '/api.php' },
  // json.tarkov.dev keeps the rest of the request path, unlike the wiki
  // which maps onto a single fixed endpoint.
  '/api/json': { host: 'json.tarkov.dev', path: '', keepPath: true },
};

/** Longest matching prefix, so /api/json/regular/tasks resolves correctly. */
function matchUpstream(pathname) {
  const prefix = Object.keys(UPSTREAMS)
    .filter((key) => pathname === key || pathname.startsWith(key + '/'))
    .sort((a, b) => b.length - a.length)[0];
  if (!prefix) return null;

  const upstream = UPSTREAMS[prefix];
  const suffix = upstream.keepPath ? pathname.slice(prefix.length) : '';
  return { host: upstream.host, path: upstream.path + suffix };
}

/** Socket idle time, not total time: a large dataset still downloads as long as it keeps flowing. */
const UPSTREAM_TIMEOUT_MS = 30000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function proxy(request, response, upstream, search) {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = {
      // A descriptive agent is polite to the wiki and avoids default-agent blocks.
      'User-Agent': 'TarkovQuestRouter/1.0 (desktop app)',
      Accept: request.headers.accept || '*/*',
    };
    if (request.headers['content-type']) headers['Content-Type'] = request.headers['content-type'];
    if (body.length > 0) headers['Content-Length'] = body.length;

    const upstreamRequest = https.request({
      hostname: upstream.host,
      path: upstream.path + (search || ''),
      method: request.method,
      headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        'Content-Type': upstreamResponse.headers['content-type'] || 'application/json',
      });
      upstreamResponse.pipe(response);
    });

    upstreamRequest.on('error', (error) => {
      // Failing mid-body: the status is already sent, so just cut it short.
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ errors: [`Upstream unreachable: ${error.message}`] }));
    });
    // A stalled upstream would otherwise leave the page waiting forever.
    upstreamRequest.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upstreamRequest.destroy(new Error(`${upstream.host} did not answer in time`));
    });

    if (body.length > 0) upstreamRequest.write(body);
    upstreamRequest.end();
  });
}

function serveStatic(rootDir, urlPath, response) {
  const relative = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const resolved = path.join(rootDir, path.normalize(relative));

  // Never serve outside the bundled frontend.
  if (!resolved.startsWith(path.resolve(rootDir))) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      // Unknown paths fall back to index.html so the app owns its routing.
      fs.readFile(path.join(rootDir, 'index.html'), (fallbackError, html) => {
        if (fallbackError) {
          response.writeHead(404).end('Not found');
          return;
        }
        response.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] }).end(html);
      });
      return;
    }
    const type = CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }).end(data);
  });
}

/**
 * Starts the server and resolves with its base URL.
 *
 * The port is part of the origin, and the origin is what localStorage is keyed
 * by, so a random port every launch means the renderer wakes up with an empty
 * store each time: caches, settings and quest progress all gone. A fixed port
 * keeps that state; a busy one falls back to any free port rather than refusing
 * to start, which costs that session's stored state but not the app.
 */
function startServer(rootDir, port = 0, allowFallback = false) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const parsed = new URL(request.url, 'http://127.0.0.1');
      const upstream = matchUpstream(parsed.pathname);

      if (upstream) {
        proxy(request, response, upstream, parsed.search);
        return;
      }
      serveStatic(rootDir, parsed.pathname, response);
    });

    server.on('error', (error) => {
      if (allowFallback && error.code === 'EADDRINUSE' && port !== 0) {
        console.warn(`Port ${port} is taken; falling back to a random one. Stored state will not be seen this session.`);
        startServer(rootDir, 0, false).then(resolve, reject);
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

module.exports = { startServer };
