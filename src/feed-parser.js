import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  htmlEntities: true
});

export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';

  const namedEntities = {
    quot: '"',
    amp: '&',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    iexcl: '¡',
    cent: '¢',
    pound: '£',
    curren: '¤',
    yen: '¥',
    brvbar: '¦',
    sect: '§',
    uml: '¨',
    copy: '©',
    ordf: 'ª',
    laquo: '«',
    not: '¬',
    shy: '\u00ad',
    reg: '®',
    macr: '¯',
    deg: '°',
    plusmn: '±',
    sup2: '²',
    sup3: '³',
    acute: '´',
    micro: 'µ',
    para: '¶',
    middot: '·',
    cedil: '¸',
    sup1: '¹',
    ordm: 'º',
    raquo: '»',
    frac14: '¼',
    frac12: '½',
    frac34: '¾',
    iquest: '¿',
    Agrave: 'À',
    Aacute: 'Á',
    Acirc: 'Â',
    Atilde: 'Ã',
    Auml: 'Ä',
    Aring: 'Å',
    AElig: 'Æ',
    Ccedil: 'Ç',
    Egrave: 'È',
    Eacute: 'É',
    Ecirc: 'Ê',
    Euml: 'Ë',
    Igrave: 'Ì',
    Iacute: 'Í',
    Icirc: 'Î',
    Iuml: 'Ï',
    ETH: 'Ð',
    Ntilde: 'Ñ',
    Ograve: 'Ò',
    Oacute: 'Ó',
    Ocirc: 'Ô',
    Otilde: 'Õ',
    Ouml: 'Ö',
    times: '×',
    Oslash: 'Ø',
    Ugrave: 'Ù',
    Uacute: 'Ú',
    Ucirc: 'Û',
    Uuml: 'Ü',
    Yacute: 'Ý',
    THORN: 'Þ',
    szlig: 'ß',
    agrave: 'à',
    aacute: 'á',
    acirc: 'â',
    atilde: 'ã',
    auml: 'ä',
    aring: 'å',
    aelig: 'æ',
    ccedil: 'ç',
    egrave: 'è',
    eacute: 'é',
    ecirc: 'ê',
    euml: 'ë',
    igrave: 'ì',
    iacute: 'í',
    icirc: 'î',
    iuml: 'ï',
    eth: 'ð',
    ntilde: 'ñ',
    ograve: 'ò',
    oacute: 'ó',
    ocirc: 'ô',
    otilde: 'õ',
    ouml: 'ö',
    divide: '÷',
    oslash: 'ø',
    ugrave: 'ù',
    uacute: 'ú',
    ucirc: 'û',
    uuml: 'ü',
    yacute: 'ý',
    thorn: 'þ',
    yuml: 'ÿ',
    OElig: 'Œ',
    oelig: 'œ',
    Scaron: 'Š',
    scaron: 'š',
    Yuml: 'Ÿ',
    fnof: 'ƒ',
    circ: 'ˆ',
    tilde: '˜',
    Alpha: 'Α',
    Beta: 'Β',
    Gamma: 'Γ',
    Delta: 'Δ',
    Epsilon: 'Ε',
    Zeta: 'Ζ',
    Eta: 'Η',
    Theta: 'Θ',
    Iota: 'Ι',
    Kappa: 'Κ',
    Lambda: 'Λ',
    Mu: 'Μ',
    Nu: 'Ν',
    Xi: 'Ξ',
    Omicron: 'Ο',
    Pi: 'Π',
    Rho: 'Ρ',
    Sigma: 'Σ',
    Tau: 'Τ',
    Upsilon: 'Υ',
    Phi: 'Φ',
    Chi: 'Χ',
    Psi: 'Ψ',
    Omega: 'Ω',
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    epsilon: 'ε',
    zeta: 'ζ',
    eta: 'η',
    theta: 'θ',
    iota: 'ι',
    kappa: 'κ',
    lambda: 'λ',
    mu: 'μ',
    nu: 'ν',
    xi: 'ξ',
    omicron: 'ο',
    pi: 'π',
    rho: 'ρ',
    sigmaf: 'ς',
    sigma: 'σ',
    tau: 'τ',
    upsilon: 'υ',
    phi: 'φ',
    chi: 'χ',
    psi: 'ψ',
    omega: 'ω',
    thetasym: 'ϑ',
    upsih: 'ϒ',
    piv: 'ϖ',
    ensp: ' ',
    emsp: ' ',
    thinsp: ' ',
    zwnj: '\u200c',
    zwj: '\u200d',
    lrm: '\u200e',
    rlm: '\u200f',
    ndash: '-',
    mdash: '-',
    lsquo: "'",
    rsquo: "'",
    sbquo: '‚',
    ldquo: '"',
    rdquo: '"',
    bdquo: '„',
    dagger: '†',
    Dagger: '‡',
    bull: '•',
    hellip: '…',
    permil: '‰',
    prime: '′',
    Prime: '″',
    lsaquo: '‹',
    rsaquo: '›',
    oline: '‾',
    frasl: '⁄',
    euro: '€',
    trade: '™'
  };

  const decodePass = (text) => {
    return text
      .replace(/&#(\d+);/g, (_, code) => {
        try {
          return String.fromCodePoint(parseInt(code, 10));
        } catch {
          return '';
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
          return String.fromCodePoint(parseInt(hex, 16));
        } catch {
          return '';
        }
      })
      .replace(/&([a-zA-Z]+);/g, (match, name) => {
        return Object.prototype.hasOwnProperty.call(namedEntities, name)
          ? namedEntities[name]
          : match;
      });
  };

  let decoded = decodePass(str);
  if (decoded.includes('&') && /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/.test(decoded)) {
    decoded = decodePass(decoded);
  }
  return decoded;
}

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
  let text = '';
  if (typeof node === 'string') text = node;
  else if (typeof node === 'object') {
    if (node['#text']) text = String(node['#text']);
    else if (node['__cdata']) text = String(node['__cdata']);
  } else {
    text = String(node);
  }
  return decodeHtmlEntities(text.trim());
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
      const epNumber = extractText(item['itunes:episode']) || extractText(item['podcast:episode']) || extractText(item.episode) || null;
      const epSeason = extractText(item['itunes:season']) || extractText(item['podcast:season']) || extractText(item.season) || null;

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
        link: epLink,
        episodeNumber: epNumber,
        season: epSeason
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
      const epNumber = extractText(entry['itunes:episode']) || extractText(entry['podcast:episode']) || extractText(entry.episode) || null;
      const epSeason = extractText(entry['itunes:season']) || extractText(entry['podcast:season']) || extractText(entry.season) || null;

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
        link,
        episodeNumber: epNumber,
        season: epSeason
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

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateOpml(subscriptions) {
  const dateStr = new Date().toUTCString();
  const outlines = (subscriptions || []).map(sub => {
    const title = escapeXml(sub.title || sub.podcast_url);
    const xmlUrl = escapeXml(sub.podcast_url);
    const htmlUrl = escapeXml(sub.link || '');
    const desc = escapeXml(sub.description || '');
    return `      <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}" description="${desc}"/>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>AntennaPodder Subscriptions</title>
    <dateCreated>${dateStr}</dateCreated>
  </head>
  <body>
    <outline text="feeds" title="feeds">
${outlines}
    </outline>
  </body>
</opml>
`;
}
