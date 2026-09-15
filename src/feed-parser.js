import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false
});

function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const str = String(durationStr).trim();
  if (!str) return 0;

  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  const parts = str.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function parsePubDate(dateStr) {
  if (!dateStr) return Math.floor(Date.now() / 1000);
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
}

function extractText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object') {
    if (node['#text']) return String(node['#text']).trim();
    if (node['__cdata']) return String(node['__cdata']).trim();
  }
  return String(node).trim();
}

function extractImage(item, fallbackImage = '') {
  if (!item) return fallbackImage;
  // itunes:image href
  if (item['itunes:image'] && item['itunes:image']['@_href']) {
    return item['itunes:image']['@_href'];
  }
  // standard image
  if (item.image) {
    if (typeof item.image === 'string') return item.image;
    if (item.image.url) return extractText(item.image.url);
    if (item.image['@_href']) return item.image['@_href'];
  }
  return fallbackImage;
}

export function parsePodcastFeed(xmlContent, feedUrl) {
  const parsed = parser.parse(xmlContent);

  // Check RSS 2.0
  if (parsed.rss && parsed.rss.channel) {
    const ch = parsed.rss.channel;
    const title = extractText(ch.title) || 'Untitled Podcast';
    const description = extractText(ch.description) || extractText(ch['itunes:summary']) || '';
    const author = extractText(ch['itunes:author']) || extractText(ch.author) || extractText(ch['itunes:owner']?.['itunes:name']) || '';
    const link = extractText(ch.link) || feedUrl;
    const imageUrl = extractImage(ch);

    let rawItems = ch.item || [];
    if (!Array.isArray(rawItems)) {
      rawItems = [rawItems];
    }

    const episodes = [];
    for (const item of rawItems) {
      if (!item) continue;

      let enclosureUrl = '';
      let enclosureType = 'audio/mpeg';
      let enclosureLength = 0;

      if (item.enclosure) {
        enclosureUrl = item.enclosure['@_url'] || '';
        enclosureType = item.enclosure['@_type'] || 'audio/mpeg';
        enclosureLength = parseInt(item.enclosure['@_length'], 10) || 0;
      } else if (item['media:content']) {
        const mc = Array.isArray(item['media:content']) ? item['media:content'][0] : item['media:content'];
        enclosureUrl = mc['@_url'] || '';
        enclosureType = mc['@_type'] || 'audio/mpeg';
        enclosureLength = parseInt(mc['@_fileSize'] || mc['@_length'], 10) || 0;
      }

      if (!enclosureUrl) continue;

      const guid = extractText(item.guid) || enclosureUrl;
      const epTitle = extractText(item.title) || 'Untitled Episode';
      const epDesc = extractText(item['content:encoded']) || extractText(item.description) || extractText(item['itunes:summary']) || '';
      const epDuration = parseDuration(extractText(item['itunes:duration']));
      const epPubDate = parsePubDate(extractText(item.pubDate));
      const epImage = extractImage(item, imageUrl);
      const epLink = extractText(item.link) || link;

      episodes.push({
        guid,
        title: epTitle,
        enclosureUrl,
        enclosureType,
        enclosureLength,
        duration: epDuration,
        pubDate: epPubDate,
        description: epDesc,
        imageUrl: epImage,
        link: epLink
      });
    }

    return {
      podcast: {
        url: feedUrl,
        title,
        description,
        author,
        link,
        imageUrl
      },
      episodes
    };
  }

  // Check Atom Feed
  if (parsed.feed) {
    const f = parsed.feed;
    const title = extractText(f.title) || 'Untitled Podcast';
    const description = extractText(f.subtitle) || '';
    const author = extractText(f.author?.name) || '';
    let link = feedUrl;
    if (Array.isArray(f.link)) {
      const alt = f.link.find(l => l['@_rel'] === 'alternate');
      if (alt && alt['@_href']) link = alt['@_href'];
    } else if (f.link && f.link['@_href']) {
      link = f.link['@_href'];
    }
    const imageUrl = extractImage(f);

    let rawEntries = f.entry || [];
    if (!Array.isArray(rawEntries)) {
      rawEntries = [rawEntries];
    }

    const episodes = [];
    for (const entry of rawEntries) {
      if (!entry) continue;

      let enclosureUrl = '';
      let enclosureType = 'audio/mpeg';
      let enclosureLength = 0;

      if (Array.isArray(entry.link)) {
        const enc = entry.link.find(l => l['@_rel'] === 'enclosure');
        if (enc && enc['@_href']) {
          enclosureUrl = enc['@_href'];
          enclosureType = enc['@_type'] || 'audio/mpeg';
          enclosureLength = parseInt(enc['@_length'], 10) || 0;
        }
      } else if (entry.link && entry.link['@_rel'] === 'enclosure') {
        enclosureUrl = entry.link['@_href'];
        enclosureType = entry.link['@_type'] || 'audio/mpeg';
        enclosureLength = parseInt(entry.link['@_length'], 10) || 0;
      }

      if (!enclosureUrl) continue;

      const guid = extractText(entry.id) || enclosureUrl;
      const epTitle = extractText(entry.title) || 'Untitled Episode';
      const epDesc = extractText(entry.content) || extractText(entry.summary) || '';
      const epPubDate = parsePubDate(extractText(entry.published) || extractText(entry.updated));
      const epImage = extractImage(entry, imageUrl);

      episodes.push({
        guid,
        title: epTitle,
        enclosureUrl,
        enclosureType,
        enclosureLength,
        duration: 0,
        pubDate: epPubDate,
        description: epDesc,
        imageUrl: epImage,
        link
      });
    }

    return {
      podcast: {
        url: feedUrl,
        title,
        description,
        author,
        link,
        imageUrl
      },
      episodes
    };
  }

  throw new Error('Unsupported podcast feed format or invalid XML');
}

export async function fetchAndParseFeed(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'AntennaPodder/1.0 (Podcast Companion; +https://github.com/AntennaPod/AntennaPod)'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch feed: HTTP ${res.status} ${res.statusText}`);
  }

  const xmlText = await res.text();
  return parsePodcastFeed(xmlText, feedUrl);
}
