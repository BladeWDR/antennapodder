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
  getEpisodeById,
  markEpisodesPlayedBatch,
  markAllEpisodesPlayed,
  getEpisodeActions
} from '../src/db.js';
import { handleWebRoutes } from '../src/web-api.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'data-test-batch-mark-played');

test('Batch mark episodes played and mark all episodes played with AntennaPod delta sync', async (t) => {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(TEST_DATA_DIR);
  const admin = getUserByUsername(db, 'admin');
  assert.ok(admin);

  const { token: sessionToken } = createSession(db, admin.id);

  const podId = upsertPodcast(db, {
    url: 'https://example.com/batchpod.xml',
    title: 'Batch Podcast',
    description: 'Testing batch mark played',
    imageUrl: 'https://example.com/batchpod.jpg',
    author: 'Batch Author',
    link: 'https://example.com/batchpod'
  });

  addSubscription(db, admin.id, 'https://example.com/batchpod.xml');

  const ep1Id = upsertEpisode(db, podId, {
    guid: 'batch-ep-1',
    title: 'Batch Episode 1',
    enclosureUrl: 'https://example.com/batch1.mp3',
    enclosureType: 'audio/mpeg',
    duration: 1200,
    pubDate: 1700000000
  });

  const ep2Id = upsertEpisode(db, podId, {
    guid: 'batch-ep-2',
    title: 'Batch Episode 2',
    enclosureUrl: 'https://example.com/batch2.mp3',
    enclosureType: 'audio/mpeg',
    duration: 1800,
    pubDate: 1700000100
  });

  const ep3Id = upsertEpisode(db, podId, {
    guid: 'batch-ep-3',
    title: 'Batch Episode 3',
    enclosureUrl: 'https://example.com/batch3.mp3',
    enclosureType: 'audio/mpeg',
    duration: 2400,
    pubDate: 1700000200
  });

  // 1. Direct DB test: markEpisodesPlayedBatch
  const batchRes = markEpisodesPlayedBatch(db, admin.id, [ep1Id, ep2Id]);
  assert.equal(batchRes.count, 2);

  const ep1 = getEpisodeById(db, ep1Id, admin.id);
  const ep2 = getEpisodeById(db, ep2Id, admin.id);
  const ep3 = getEpisodeById(db, ep3Id, admin.id);

  assert.equal(ep1.is_played, 1);
  assert.equal(ep1.position, 1200);
  assert.equal(ep2.is_played, 1);
  assert.equal(ep2.position, 1800);
  assert.equal(ep3.is_played, 0);

  // Check sync actions
  const actionsRes = getEpisodeActions(db, admin.id, 0);
  const playActions = actionsRes.actions.filter(a => a.action === 'play');
  assert.equal(playActions.length, 2);
  assert.ok(playActions.some(a => a.episode === 'https://example.com/batch1.mp3' && a.position === 1200));
  assert.ok(playActions.some(a => a.episode === 'https://example.com/batch2.mp3' && a.position === 1800));

  // 2. Direct DB test: markAllEpisodesPlayed
  // Only ep3 is unplayed, so count should be 1
  const allRes = markAllEpisodesPlayed(db, admin.id, podId);
  assert.equal(allRes.count, 1);

  const ep3After = getEpisodeById(db, ep3Id, admin.id);
  assert.equal(ep3After.is_played, 1);
  assert.equal(ep3After.position, 2400);

  // Calling markAllEpisodesPlayed again when all are played should return count: 0
  const allAgainRes = markAllEpisodesPlayed(db, admin.id, podId);
  assert.equal(allAgainRes.count, 0);

  // 3. Test HTTP API Endpoints
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

      res.writeHead(404);
      res.end('Not found');
    });
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    async function apiRequest(method, endpoint, body = null, token = sessionToken) {
      const res = await fetch(`http://localhost:${port}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Cookie': `sessionid=${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    }

    // Create second podcast with unplayed episodes for API testing
    const pod2Id = upsertPodcast(db, {
      url: 'https://example.com/batchpod2.xml',
      title: 'Batch Podcast 2',
      description: 'Testing API endpoints',
      imageUrl: 'https://example.com/batchpod2.jpg',
      author: 'Batch Author 2',
      link: 'https://example.com/batchpod2'
    });
    addSubscription(db, admin.id, 'https://example.com/batchpod2.xml');

    const pod2Ep1Id = upsertEpisode(db, pod2Id, {
      guid: 'batch2-ep-1',
      title: 'Batch 2 Episode 1',
      enclosureUrl: 'https://example.com/batch2-1.mp3',
      enclosureType: 'audio/mpeg',
      duration: 600,
      pubDate: 1700000300
    });

    const pod2Ep2Id = upsertEpisode(db, pod2Id, {
      guid: 'batch2-ep-2',
      title: 'Batch 2 Episode 2',
      enclosureUrl: 'https://example.com/batch2-2.mp3',
      enclosureType: 'audio/mpeg',
      duration: 900,
      pubDate: 1700000400
    });

    // Test POST /api/episodes/mark-played-batch
    const batchApiRes = await apiRequest('POST', '/api/episodes/mark-played-batch', {
      episodeIds: [pod2Ep1Id]
    });
    assert.equal(batchApiRes.status, 200);
    assert.equal(batchApiRes.data.success, true);
    assert.equal(batchApiRes.data.count, 1);

    const pod2Ep1Check = getEpisodeById(db, pod2Ep1Id, admin.id);
    assert.equal(pod2Ep1Check.is_played, 1);

    // Test invalid input for batch endpoint
    const invalidBatchRes = await apiRequest('POST', '/api/episodes/mark-played-batch', {
      episodeIds: 'not-an-array'
    });
    assert.equal(invalidBatchRes.status, 400);

    // Test POST /api/podcasts/:id/mark-all-played
    const markAllApiRes = await apiRequest('POST', `/api/podcasts/${pod2Id}/mark-all-played`);
    assert.equal(markAllApiRes.status, 200);
    assert.equal(markAllApiRes.data.success, true);
    assert.equal(markAllApiRes.data.count, 1); // pod2Ep2 was unplayed

    const pod2Ep2Check = getEpisodeById(db, pod2Ep2Id, admin.id);
    assert.equal(pod2Ep2Check.is_played, 1);

    // Test 404 for non-existent podcast
    const notFoundRes = await apiRequest('POST', '/api/podcasts/99999/mark-all-played');
    assert.equal(notFoundRes.status, 404);

    // Test 401 without auth
    const unauthRes = await apiRequest('POST', `/api/podcasts/${pod2Id}/mark-all-played`, null, null);
    assert.equal(unauthRes.status, 401);
  } finally {
    server.close();
    db.close();
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  }
});
