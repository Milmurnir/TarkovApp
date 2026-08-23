'use strict';

/**
 * Local server for the packaged app.
 *
 * Serves the built frontend and proxies the two upstreams, mirroring the Vite
 * dev proxy exactly. Loading the renderer over http://127.0.0.1 rather than
 * file:// means the app has a normal origin, so fetch, CORS and localStorage all
 * behave the same as they do in development and the frontend needs no changes.
 *
 * Bound to 127.0.0.1 on a random free port: nothing is exposed to the network.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const UPSTREAMS = {
  '/api/wiki': { host: 'escapefromtarkov.fandom.com', path: '/api.php' },
  '/api/tarkov': { host: 'api.tarkov.dev', path: '/graphql' },
  // json.tarkov.dev keeps the rest of the request path, unlike the two above
  // which map onto a single fixed endpoint.
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
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ errors: [`Upstream unreachable: ${error.message}`] }));
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

/** Starts the server and resolves with its base URL. */
function startServer(rootDir, port = 0) {
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

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

module.exports = { startServer };
