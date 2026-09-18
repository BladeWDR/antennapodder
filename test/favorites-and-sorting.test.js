import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  getDatabase,
  getUserByUsername,
  createSession,
  addSubscription,
  upsertPodcast,
  upsertEpisode,
  getUserSubscriptions,
  getPodcastById,
  togglePodcastFavorite,
  toggleEpisodeFavorite,
  getFavoriteEpisodes,
  applyEpisodeActionsFromClient,
  getEpisodeActions
} from '../src/db.js';
import { handleWebRoutes } from '../src/web-api.js';
import { handleGpodderRoutes } from '../src/gpodder.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'data-test-favorites');

test('Podcast sorting, favorite podcasts, and favorite episodes two-way sync', async (t) => {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(TEST_DATA_DIR);
  const admin = getUserByUsername(db, 'admin');
  assert.ok(admin);

  const { token: sessionToken } = createSession(db, admin.id);

  // Setup sample podcasts and episodes
  const pod1Id = upsertPodcast(db, {
    url: 'https://example.com/pod1.xml',
    title: 'Zeta Podcast',
    description: 'Latest updates',
    imageUrl: 'https://example.com/pod1.jpg',
    author: 'Author Z',
    link: 'https://example.com/pod1'
  });

  const pod2Id = upsertPodcast(db, {
    url: 'https://example.com/pod2.xml',
    title: 'Alpha Podcast',
    description: 'Alpha updates',
    imageUrl: 'https://example.com/pod2.jpg',
    author: 'Author A',
    link: 'https://example.com/pod2'
  });

  addSubscription(db, admin.id, 'https://example.com/pod1.xml');
  addSubscription(db, admin.id, 'https://example.com/pod2.xml');

  const ep1Id = upsertEpisode(db, pod1Id, {
    guid: 'ep-1-guid',
    title: 'Zeta Ep 1',
    enclosureUrl: 'https://example.com/zeta1.mp3',
    enclosureType: 'audio/mpeg',
    enclosureLength: 1000,
    duration: 1800,
    pubDate: 1700000000,
    description: 'First ep',
    imageUrl: null,
    link: null
  });

  const ep2Id = upsertEpisode(db, pod2Id, {
    guid: 'ep-2-guid',
    title: 'Alpha Ep 1',
    enclosureUrl: 'https://example.com/alpha1.mp3',
    enclosureType: 'audio/mpeg',
    enclosureLength: 1000,
    duration: 2400,
    pubDate: 1710000000,
    description: 'Alpha ep',
    imageUrl: null,
    link: null
  });

  // 1. Verify Library Sorting Data in getUserSubscriptions
  const subs = getUserSubscriptions(db, admin.id);
  assert.equal(subs.length, 2);
  const alphaPod = subs.find(s => s.title === 'Alpha Podcast');
  const zetaPod = subs.find(s => s.title === 'Zeta Podcast');
  assert.ok(alphaPod);
  assert.ok(zetaPod);
  assert.equal(alphaPod.total_episodes, 1);
  assert.equal(alphaPod.unplayed_episodes, 1);
  assert.equal(alphaPod.is_favorite, 0);
  assert.equal(zetaPod.total_episodes, 1);
  assert.equal(zetaPod.unplayed_episodes, 1);

  // 2. Test Podcast Favorite Toggle
  const favResult = togglePodcastFavorite(db, admin.id, pod2Id);
  assert.equal(favResult.is_favorite, 1);
  const pod2Detail = getPodcastById(db, pod2Id, admin.id);
  assert.equal(pod2Detail.is_favorite, true);

  // Untoggle podcast favorite
  const unfavResult = togglePodcastFavorite(db, admin.id, pod2Id);
  assert.equal(unfavResult.is_favorite, 0);

  // Retoggle to 1
  togglePodcastFavorite(db, admin.id, pod2Id);

  // 3. Test Episode Favorite Toggle
  const epFavResult = toggleEpisodeFavorite(db, admin.id, ep1Id);
  assert.equal(epFavResult.is_favorite, 1);

  const favEpisodes = getFavoriteEpisodes(db, admin.id);
  assert.equal(favEpisodes.length, 1);
  assert.equal(favEpisodes[0].id, ep1Id);
  assert.equal(favEpisodes[0].is_favorite, 1);

  // Check actions logged for gPodder sync
  const actionsRes = getEpisodeActions(db, admin.id, 0);
  assert.ok(actionsRes.actions.some(a => a.action === 'favorite' && a.is_favorite === 1));

  // 4. Test Web Server HTTP Endpoints
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

      if (await handleWebRoutes(db, req, res, pathname, query, body)) return;
      if (await handleGpodderRoutes(db, req, res, pathname, query, body)) return;

      res.writeHead(404);
      res.end('Not found');
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test POST /api/podcasts/:id/favorite
    const podFavRes = await fetch(`${baseUrl}/api/podcasts/${pod1Id}/favorite`, {
      method: 'POST',
      headers: { Cookie: `sessionid=${sessionToken}` }
    });
    assert.equal(podFavRes.status, 200);
    const podFavData = await podFavRes.json();
    assert.equal(podFavData.success, true);
    assert.equal(podFavData.is_favorite, 1);

    // Test POST /api/episodes/:id/toggle-favorite
    const epFavRes = await fetch(`${baseUrl}/api/episodes/${ep2Id}/toggle-favorite`, {
      method: 'POST',
      headers: { Cookie: `sessionid=${sessionToken}` }
    });
    assert.equal(epFavRes.status, 200);
    const epFavData = await epFavRes.json();
    assert.equal(epFavData.success, true);
    assert.equal(epFavData.state.is_favorite, 1);

    // Test GET /api/episodes/favorites
    const getFavsRes = await fetch(`${baseUrl}/api/episodes/favorites`, {
      headers: { Cookie: `sessionid=${sessionToken}` }
    });
    assert.equal(getFavsRes.status, 200);
    const getFavsData = await getFavsRes.json();
    assert.equal(getFavsData.episodes.length, 2);

    // 5. Test Two-Way Sync with AntennaPod / gPodder
    // Simulate AntennaPod sending an unfavorite action
    const gpodderSyncRes = await fetch(`${baseUrl}/api/2/episodes/admin.json`, {
      method: 'POST',
      headers: {
        Cookie: `sessionid=${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          podcast: 'https://example.com/pod1.xml',
          episode: 'https://example.com/zeta1.mp3',
          guid: 'ep-1-guid',
          action: 'unfavorite',
          timestamp: new Date().toISOString()
        }
      ])
    });
    assert.equal(gpodderSyncRes.status, 200);

    // Verify ep1 is now unfavorited
    const favsAfterAntennaPod = getFavoriteEpisodes(db, admin.id);
    assert.equal(favsAfterAntennaPod.length, 1);
    assert.equal(favsAfterAntennaPod[0].id, ep2Id);

    // Simulate AntennaPod playing an episode (should NOT wipe favorite status)
    const gpodderPlayRes = await fetch(`${baseUrl}/api/2/episodes/admin.json`, {
      method: 'POST',
      headers: {
        Cookie: `sessionid=${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          podcast: 'https://example.com/pod2.xml',
          episode: 'https://example.com/alpha1.mp3',
          guid: 'ep-2-guid',
          action: 'play',
          position: 600,
          total: 2400,
          timestamp: new Date().toISOString()
        }
      ])
    });
    assert.equal(gpodderPlayRes.status, 200);

    // Verify ep2 is STILL favorited after play action
    const favsAfterPlay = getFavoriteEpisodes(db, admin.id);
    assert.equal(favsAfterPlay.length, 1);
    assert.equal(favsAfterPlay[0].id, ep2Id);
    assert.equal(favsAfterPlay[0].position, 600);

    // Test OPML Export endpoint
    const opmlRes = await fetch(`${baseUrl}/api/library/export.opml`, {
      headers: { Cookie: `sessionid=${sessionToken}` }
    });
    assert.equal(opmlRes.status, 200);
    assert.ok(opmlRes.headers.get('content-type').includes('application/xml'));
    assert.ok(opmlRes.headers.get('content-disposition').includes('attachment'));
    const opmlText = await opmlRes.text();
    assert.ok(opmlText.includes('<opml version="2.0">'));
    assert.ok(opmlText.includes('xmlUrl="https://example.com/pod1.xml"'));
    assert.ok(opmlText.includes('xmlUrl="https://example.com/pod2.xml"'));
    assert.ok(opmlText.includes('title="Alpha Podcast"'));
    assert.ok(opmlText.includes('title="Zeta Podcast"'));
  } finally {
    server.close();
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  }
});
