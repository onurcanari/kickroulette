const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 45_000;
const MAX_PAGE = 40;
const cache = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function cacheKey(lang, page, limit) {
  return `${lang}:${page}:${limit}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

async function fetchKickPage(lang, page, limit) {
  const key = cacheKey(lang, page, limit);
  const cached = getCached(key);
  if (cached) return cached;

  // sort=desc is required — without it Kick often returns 0-viewer / dead listings
  const url = `https://kick.com/stream/livestreams/${encodeURIComponent(lang)}?page=${page}&limit=${limit}&sort=desc`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kick API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  setCache(key, json);
  return json;
}

function normalizeStream(item) {
  const channel = item.channel || {};
  const user = channel.user || {};
  const cats = item.categories || [];
  const cat = cats[0] || {};
  const slug = channel.slug || '';
  const thumb =
    (item.thumbnail && (item.thumbnail.src || item.thumbnail)) || null;

  return {
    slug,
    username: user.username || slug,
    title: item.session_title || item.slug || 'Live',
    viewer_count: item.viewer_count ?? item.viewers ?? 0,
    category: cat.name || (cat.category && cat.category.name) || null,
    category_slug: cat.slug || null,
    thumbnail: typeof thumb === 'string' ? thumb : null,
    language: item.language || null,
    is_mature: Boolean(item.is_mature),
    profilepic: user.profilepic || null,
    kick_url: slug ? `https://kick.com/${slug}` : null,
  };
}

function matchesFilters(stream, { minViewers, maxViewers, mature, category }) {
  const viewers = Number(stream.viewer_count) || 0;
  if (viewers < minViewers) return false;
  if (maxViewers != null && !Number.isNaN(maxViewers) && viewers > maxViewers) {
    return false;
  }
  // mature=true → allow all; mature=false → exclude mature
  if (!mature && stream.is_mature) return false;
  if (category) {
    const q = String(category).toLowerCase();
    const name = (stream.category || '').toLowerCase();
    const slug = (stream.category_slug || '').toLowerCase();
    if (!name.includes(q) && !slug.includes(q)) return false;
  }
  return true;
}

app.get('/api/streams', async (req, res) => {
  try {
    const lang = String(req.query.lang || 'en').toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const data = await fetchKickPage(lang, page, limit);
    res.json(data);
  } catch (err) {
    console.error('[/api/streams]', err.message);
    res.status(502).json({ error: 'Failed to fetch streams from Kick', detail: err.message });
  }
});

app.get('/api/random', async (req, res) => {
  try {
    const lang = String(req.query.lang || 'en').toLowerCase();
    const minViewers = Math.max(0, parseInt(req.query.minViewers, 10) || 0);
    const maxRaw = req.query.maxViewers;
    const maxViewers =
      maxRaw === undefined || maxRaw === '' || maxRaw === null
        ? null
        : parseInt(maxRaw, 10);
    const mature =
      req.query.mature === undefined ||
      req.query.mature === '' ||
      String(req.query.mature).toLowerCase() === 'true';
    const category = (req.query.category || '').trim();
    const exclude = String(req.query.exclude || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const filters = { minViewers, maxViewers, mature, category };
    const limit = 50;
    const triedPages = new Set();
    let candidates = [];

    // Sample 2–3 random pages; retry empty ones
    const pagesToTry = 3;
    for (let attempt = 0; attempt < pagesToTry + 5 && candidates.length < 5; attempt++) {
      let page;
      if (triedPages.size >= MAX_PAGE) break;
      do {
        page = 1 + Math.floor(Math.random() * MAX_PAGE);
      } while (triedPages.has(page) && triedPages.size < MAX_PAGE);
      triedPages.add(page);

      let json;
      try {
        json = await fetchKickPage(lang, page, limit);
      } catch (e) {
        console.warn(`page ${page} failed:`, e.message);
        continue;
      }

      const data = Array.isArray(json?.data) ? json.data : [];
      if (!data.length) continue;

      const mapped = data.map(normalizeStream).filter((s) => s.slug);
      const filtered = mapped.filter(
        (s) =>
          matchesFilters(s, filters) &&
          !exclude.includes(s.slug.toLowerCase())
      );
      candidates = candidates.concat(filtered);

      // Also try page 1 once for better density if filters are strict
      if (attempt === 0 && page !== 1 && candidates.length < 3) {
        triedPages.add(1);
        try {
          const first = await fetchKickPage(lang, 1, limit);
          const firstData = Array.isArray(first?.data) ? first.data : [];
          candidates = candidates.concat(
            firstData
              .map(normalizeStream)
              .filter((s) => s.slug)
              .filter(
                (s) =>
                  matchesFilters(s, filters) &&
                  !exclude.includes(s.slug.toLowerCase())
              )
          );
        } catch (_) {
          /* ignore */
        }
      }
    }

    // Deduplicate by slug
    const bySlug = new Map();
    for (const s of candidates) {
      if (!bySlug.has(s.slug)) bySlug.set(s.slug, s);
    }
    candidates = [...bySlug.values()];

    if (!candidates.length) {
      return res.status(404).json({
        error: 'No streams matched your filters. Try lowering min viewers or enabling mature.',
      });
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    res.json(pick);
  } catch (err) {
    console.error('[/api/random]', err.message);
    res.status(502).json({ error: 'Failed to pick a random stream', detail: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, cacheEntries: cache.size });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KickRoulette running at http://localhost:${PORT}`);
});
