# KickRoulette

Classic stream roulette for [Kick.com](https://kick.com): open the site, land on a random live stream, hit **Next** (or press `Space` / `N`) to spin again.

Kick-branded dark UI (black + green `#53FC18`). No Kick OAuth — the Express server proxies Kick’s public livestream listing API (browser CORS would block direct calls).

## Run

```bash
cd /workspace/kickroulette
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/streams?lang=en&page=1&limit=50` | Proxy of Kick livestream pages |
| `GET /api/random?lang=en&minViewers=0&maxViewers=&mature=true&category=` | Random live stream matching filters |
| `GET /api/health` | Simple health check |

Example:

```bash
curl -s 'http://localhost:3000/api/random?lang=en' | jq .
```

## Filters (UI + `/api/random`)

- **lang** — Kick listing language (`en`, `tr`, `es`, …)
- **minViewers** / **maxViewers**
- **mature** — `true` allows mature; `false` excludes them
- **category** — substring match on category name/slug
- **exclude** — comma-separated slugs to skip (UI avoids recent repeats)

## Notes / limitations

- Stream lists are cached in memory for ~45s to be polite to Kick.
- The player uses Kick’s official embed: `https://player.kick.com/{slug}?autoplay=true`.
- Chat iframe embeds (`kick.com/.../chatroom`) are often blocked by Kick’s frame headers; the sidebar shows stream info + “Open on Kick” instead.
- Kick’s public listing can return sparse/empty high page numbers; the server retries other pages.
- Kick’s listing without `sort=desc` often returns 0-viewer streams; this app always requests `sort=desc`.
- Language path (`/livestreams/{lang}`) is soft — Kick may still return streams tagged with other languages in the ranked list.
- This is an unofficial fan project and depends on Kick’s public website endpoints remaining available.

## Stack

- Node.js + Express (static `public/` + API proxy)
- Vanilla HTML/CSS/JS frontend
