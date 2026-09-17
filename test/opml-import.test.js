import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  getDatabase,
  getUserByUsername,
  createSession,
  getUserSubscriptions,
  getSubscriptionDeltas
} from '../src/db.js';
import { handleWebRoutes } from '../src/web-api.js';
import { parseOpml, generateOpml } from '../src/feed-parser.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'data-test-opml');

test('OPML Import and Parser test suite', async () => {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  // 1. Unit Tests for parseOpml
  const sampleOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>AntennaPod Subscriptions</title>
  </head>
  <body>
    <outline text="feeds" title="feeds">
      <outline type="rss" text="Dan Carlin&apos;s Hardcore History" title="Dan Carlin&apos;s Hardcore History" xmlUrl="https://feeds.feedburner.com/dancarlin/hh" htmlUrl="https://www.dancarlin.com" />
      <outline text="Tech &amp; News">
        <outline type="rss" text="Ars Technica" title="Ars Technica" xmlUrl="https://arstechnica.com/feed/" />
        <outline type="rss" text="Duplicate Ars" xmlUrl="https://arstechnica.com/feed/" />
      </outline>
    </outline>
  </body>
</opml>`;

  const feeds = parseOpml(sampleOpml);
  assert.equal(feeds.length, 2, 'Deduplicated to 2 feeds');
  assert.equal(feeds[0].title, "Dan Carlin's Hardcore History");
  assert.equal(feeds[0].url, 'https://feeds.feedburner.com/dancarlin/hh');
  assert.equal(feeds[1].title, 'Ars Technica');
  assert.equal(feeds[1].url, 'https://arstechnica.com/feed/');

  // Test regex fallback on slightly broken XML
  const brokenXmlOpml = `<opml><body>
    <outline text="Broken Tag Podcast" xmlUrl="https://broken.example.com/rss.xml" >
    <outline title="Another Show" xmlUrl="https://another.example.com/feed.xml"/>
  <broken unclosed tag`;
  const brokenFeeds = parseOpml(brokenXmlOpml);
  assert.equal(brokenFeeds.length, 2);
  assert.equal(brokenFeeds[0].url, 'https://broken.example.com/rss.xml');
  assert.equal(brokenFeeds[0].title, 'Broken Tag Podcast');
  assert.equal(brokenFeeds[1].url, 'https://another.example.com/feed.xml');
  assert.equal(brokenFeeds[1].title, 'Another Show');

  // Test empty/invalid
  assert.deepEqual(parseOpml(''), []);
  assert.deepEqual(parseOpml(null), []);
  assert.deepEqual(parseOpml('<opml></opml>'), []);

  // 2. Integration Tests with HTTP Web API
  const db = getDatabase(TEST_DATA_DIR);
  const admin = getUserByUsername(db, 'admin');
  assert.ok(admin);

  const session = createSession(db, admin.id);
  const sessionToken = session.token;

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const query = urlObj.searchParams;

    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      let body = null;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }

      const handled = await handleWebRoutes(db, req, res, pathname, query, body);
      if (handled) return;

      res.writeHead(404);
      res.end('Not Found');
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Unauthorized check
    const unauthRes = await fetch(`${baseUrl}/api/library/import.opml`, {
      method: 'POST',
      body: sampleOpml
    });
    assert.equal(unauthRes.status, 401);

    // Empty body check
    const emptyRes = await fetch(`${baseUrl}/api/library/import.opml`, {
      method: 'POST',
      headers: {
        Cookie: `sessionid=${sessionToken}`,
        'Content-Type': 'application/xml'
      },
      body: '   '
    });
    assert.equal(emptyRes.status, 400);

    // Successful OPML import
    const importRes = await fetch(`${baseUrl}/api/library/import.opml`, {
      method: 'POST',
      headers: {
        Cookie: `sessionid=${sessionToken}`,
        'Content-Type': 'application/xml'
      },
      body: sampleOpml
    });
    assert.equal(importRes.status, 200);
    const importData = await importRes.json();
    assert.equal(importData.success, true);
    assert.equal(importData.total, 2);
    assert.equal(importData.imported, 2);
    assert.equal(importData.alreadySubscribed, 0);

    // Verify subscriptions in library
    const subs = getUserSubscriptions(db, admin.id);
    assert.equal(subs.length, 2);
    const hardCoreSub = subs.find(s => s.podcast_url === 'https://feeds.feedburner.com/dancarlin/hh');
    assert.ok(hardCoreSub);
    assert.equal(hardCoreSub.title, "Dan Carlin's Hardcore History");

    // Verify subscription log generated for AntennaPod delta sync
    const deltas = getSubscriptionDeltas(db, admin.id, 0);
    assert.ok(deltas.add.includes('https://feeds.feedburner.com/dancarlin/hh'));
    assert.ok(deltas.add.includes('https://arstechnica.com/feed/'));

    // Second import with overlapping and new feeds
    const secondOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Ars Technica" xmlUrl="https://arstechnica.com/feed/" />
    <outline type="rss" text="BBC Global News" xmlUrl="https://podcasts.files.bbci.co.uk/p02nq0gn.rss" />
  </body>
</opml>`;

    const importRes2 = await fetch(`${baseUrl}/api/library/import.opml`, {
      method: 'POST',
      headers: {
        Cookie: `sessionid=${sessionToken}`,
        'Content-Type': 'application/xml'
      },
      body: secondOpml
    });
    assert.equal(importRes2.status, 200);
    const importData2 = await importRes2.json();
    assert.equal(importData2.total, 2);
    assert.equal(importData2.imported, 1);
    assert.equal(importData2.alreadySubscribed, 1);

    // Total active subscriptions should now be 3
    const subsAfter = getUserSubscriptions(db, admin.id);
    assert.equal(subsAfter.length, 3);

    // Test JSON payload support with { opml: ... }
    const jsonOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="JSON Feed" xmlUrl="https://example.com/jsonfeed.xml" />
  </body>
</opml>`;
    const importRes3 = await fetch(`${baseUrl}/api/library/import.opml`, {
      method: 'POST',
      headers: {
        Cookie: `sessionid=${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ opml: jsonOpml })
    });
    assert.equal(importRes3.status, 200);
    const importData3 = await importRes3.json();
    assert.equal(importData3.imported, 1);

    const subsFinal = getUserSubscriptions(db, admin.id);
    assert.equal(subsFinal.length, 4);

    // Verify OPML export contains the imported feeds
    const exportRes = await fetch(`${baseUrl}/api/library/export.opml`, {
      headers: { Cookie: `sessionid=${sessionToken}` }
    });
    const exportedXml = await exportRes.text();
    const reimportedFeeds = parseOpml(exportedXml);
    assert.equal(reimportedFeeds.length, 4);

  } finally {
    server.close();
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  }
});
