import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, getUserSubscriptionUrls, upsertPodcast, upsertEpisode } from './db.js';
import { fetchAndParseFeed } from './feed-parser.js';
import { handleGpodderRoutes } from './gpodder.js';
import { handleWebRoutes } from './web-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const db = getDatabase();

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

async function parseRequestBody(req) {
  return new Promise((resolve) => {
    if (['GET', 'HEAD', 'DELETE'].includes(req.method.toUpperCase())) {
      return resolve(null);
    }

    let rawData = '';
    req.on('data', (chunk) => {
      rawData += chunk;
      // Safeguard max body size (10MB)
      if (rawData.length > 10 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!rawData.trim()) return resolve(null);

      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          return resolve(JSON.parse(rawData));
        } catch (e) {
          return resolve(null);
        }
      }

      if (contentType.includes('application/x-www-form-urlencoded')) {
        try {
          const params = new URLSearchParams(rawData);
          const obj = {};
          for (const [key, val] of params.entries()) {
            if (obj[key] !== undefined) {
              if (Array.isArray(obj[key])) {
                obj[key].push(val);
              } else {
                obj[key] = [obj[key], val];
              }
            } else {
              obj[key] = val;
            }
          }
          return resolve(obj);
        } catch (e) {
          return resolve(null);
        }
      }

      // Default try parsing as JSON or return raw
      try {
        return resolve(JSON.parse(rawData));
      } catch (e) {
        return resolve(rawData);
      }
    });

    req.on('error', () => resolve(null));
  });
}

function serveStaticFile(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routes
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Static cache for assets
    const headers = { 'Content-Type': contentType };
    // Prevent stale caching so client script updates are received immediately
    headers['Cache-Control'] = 'no-cache, must-revalidate';

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS support for development or mobile clients
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  // Normalize pathname: collapse multiple slashes and handle subpath duplicates
  let pathname = urlObj.pathname.replace(/\/+/g, '/');
  if (pathname.startsWith('/api/2/api/2/')) {
    pathname = pathname.replace('/api/2/api/2/', '/api/2/');
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  const query = urlObj.searchParams;
  const body = await parseRequestBody(req);

  // Request logger
  res.on('finish', () => {
    if (!pathname.startsWith('/css/') && !pathname.startsWith('/js/') && !pathname.endsWith('.ico')) {
      console.log(`[HTTP] ${req.method} ${pathname} -> ${res.statusCode}`);
    }
  });

  try {
    // 1. gPodder API & Nextcloud gpoddersync compatibility
    const handledGpodder = await handleGpodderRoutes(db, req, res, pathname, query, body);
    if (handledGpodder) return;

    // 2. Web UI REST API
    const handledWeb = await handleWebRoutes(db, req, res, pathname, query, body);
    if (handledWeb) return;

    // 3. Static Files & SPA fallback
    const resolvedPublicDir = path.resolve(PUBLIC_DIR);
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const requestedFile = safePath === '/' ? 'index.html' : safePath;
    const fullPath = path.resolve(PUBLIC_DIR, requestedFile.startsWith('/') ? '.' + requestedFile : requestedFile);

    if (!fullPath.startsWith(resolvedPublicDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    serveStaticFile(req, res, fullPath);
  } catch (err) {
    console.error(`[Server Error] ${req.method} ${pathname}:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
});

// Periodic background feed synchronization (every 60 minutes)
async function refreshAllSubscribedFeeds() {
  try {
    const urls = db.prepare('SELECT DISTINCT podcast_url FROM subscriptions WHERE is_active = 1').all();
    for (const { podcast_url } of urls) {
      try {
        const parsed = await fetchAndParseFeed(podcast_url);
        const pId = upsertPodcast(db, parsed.podcast);
        for (const ep of parsed.episodes) {
          upsertEpisode(db, pId, ep);
        }
      } catch (e) {
        // continue with other feeds
      }
    }
  } catch (e) {
    console.error('[Periodic Feed Refresh Error]:', e);
  }
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const refreshTimer = setInterval(refreshAllSubscribedFeeds, REFRESH_INTERVAL_MS);
if (refreshTimer.unref) refreshTimer.unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[AntennaPodder] Companion server listening on http://0.0.0.0:${PORT}`);
  console.log(`[AntennaPodder] gPodder API endpoint: http://localhost:${PORT}/api/2/`);
  console.log(`[AntennaPodder] NextCloud sync compatibility: http://localhost:${PORT}/index.php/apps/gpoddersync/`);
});

process.on('SIGTERM', () => {
  console.log('[AntennaPodder] Shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[AntennaPodder] Shutting down gracefully...');
  server.close(() => process.exit(0));
});
