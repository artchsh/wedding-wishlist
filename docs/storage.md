# Storage

## Current setup: Cloudflare R2

The wishlist is one JSON object — key `wishlist.json` — in the R2 bucket `wedding-wishlist-data`,
bound to the Worker as `WISHLIST_BUCKET` (see `wrangler.jsonc`). It used to live on npoint.io (a
free JSON-document hosting API); that was migrated away because it was slow (~100-140ms per
request, external to Cloudflare's network) and added a third-party dependency with no SLA.

Reads and writes go through [`app/api/wishlist/route.ts`](../app/api/wishlist/route.ts):

- **`GET`** — serves the cached response if present (see below), otherwise reads the object from
  R2 and returns it as-is (no JSON parsing/re-serialization — it streams the stored bytes back).
- **`POST`** — validates the body parses as JSON, writes it to R2 verbatim, purges the edge
  cache.

[`app/api/wishlist/store.ts`](../app/api/wishlist/store.ts) exports `readWishlistRaw()`, a small
server-only helper that reads the R2 object directly (no HTTP, no cache layer). This exists
because [`app/api/backup/route.ts`](../app/api/backup/route.ts) needs the current document but
**cannot** call the client-side `fetchWishlist()` helper — see `gotchas.md` for why.

## Full-document replace semantics

There is no partial update. Every mutation (reserve, cancel, admin add/edit/delete, category
reorder) follows: fetch the whole `items` array client-side → transform it in memory → call
`replaceWishlist(items, categoryOrder)`, which POSTs the **entire** document back, overwriting
whatever was there.

`replaceWishlist`'s `categoryOrder` parameter is required (no default) specifically so that every
call site has to think about it — passing the wrong (or stale) `categoryOrder` would silently
wipe the admin's manual category ordering on the next save.

**This means concurrent writes can race.** If two guests reserve different gifts within the same
request window, whichever `POST` lands second overwrites the first's read-modify-write entirely.
This has been an accepted tradeoff (low traffic, low stakes — worst case someone re-reserves) and
hasn't been fixed with locking or a transactional store. If it ever becomes a real problem, the
fix would mean moving off "fetch whole doc, mutate, replace whole doc" toward something with
atomic per-item updates (e.g. one R2 object per item, or a KV/D1 redesign) — see `gotchas.md` for
why KV specifically isn't a drop-in fix either (1 write/sec per key, eventually consistent).

## Edge caching

R2 reads turned out to be *slower* than the old npoint.io API for this tiny payload in practice
(~220-250ms vs ~110ms in testing) — likely Next.js Route Handler overhead plus R2 not being
edge-cached for small objects by default. The fix: `GET /api/wishlist` caches its response in
Cloudflare's edge cache (`caches.default`) for 10 seconds, and every successful `POST` purges
that cache entry immediately via `ctx.waitUntil(cache.delete(...))`.

Net effect: writes are always immediately visible (no stale-read window), and the common case —
guests just browsing — hits the cache and responds in the same ~110-130ms range npoint.io did.

The cache key is a synthetic `Request` to a fake internal URL
(`https://wedding-wishlist-internal.cache/wishlist.json`), not the real incoming request — this
is the standard pattern for a stable cache key that doesn't vary with headers/query params on the
actual request.

**`caches` is not available under plain `next dev`** (it's a real Workers runtime global, and
local `next dev` is plain Node.js, not workerd) — `getEdgeCache()` in `route.ts` guards for this
with `typeof caches === "undefined"` and just skips caching locally. Don't remove that guard.

## Migrating away from npoint.io (already done, kept for reference)

1. Enable R2 on the Cloudflare account (dashboard-only step, not available via `wrangler` CLI on
   a fresh account — see `deployment.md`).
2. `wrangler r2 bucket create wedding-wishlist-data`
3. Fetch the live npoint.io document and upload it as the seed object:
   ```bash
   curl -s "https://api.npoint.io/<id>" -o wishlist.json
   wrangler r2 object put wedding-wishlist-data/wishlist.json --file=wishlist.json \
     --content-type=application/json --remote
   ```
4. Add the `r2_buckets` binding to `wrangler.jsonc`, regenerate types with
   `npm run cf-typegen`, swap `fetchWishlist`/`replaceWishlist` to call `/api/wishlist` instead of
   the npoint.io URL directly.
