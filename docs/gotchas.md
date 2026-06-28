# Gotchas

Things that have already broken once, or were close calls. Read this before touching storage,
deployment config, or the backup/parsing routes.

## Relative `fetch()` URLs only work client-side

`fetchWishlist()`, `replaceWishlist()`, `triggerBackup()`, and `parseKaspiUrl()` in
`app/wishlist-data.ts` all call relative URLs like `fetch("/api/wishlist")`. In a browser this
resolves against `window.location` — fine. In a Route Handler or any other server-side code,
there is no implicit base URL, and it throws:

```
TypeError: Failed to parse URL from /api/wishlist
```

**This actually happened**: `app/api/backup/route.ts` originally called `fetchWishlist()` to get
the current document, which crashed every `POST /api/backup` with a 500 after the R2 migration
(it had silently worked before only because the *previous* implementation read from an absolute
npoint.io URL, not a relative one). Fixed by adding `readWishlistRaw()` in
`app/api/wishlist/store.ts` — a server-only helper that reads the R2 binding directly — and
having `backup/route.ts` use that instead.

**Rule**: server-side code (anything in `app/api/*/route.ts`) needs the wishlist data → use
`readWishlistRaw()`. Client components → use `fetchWishlist()`. Never the reverse.

## `caches` (Workers Cache API) isn't available under `next dev`

`caches.default` is a real global in the deployed Workers runtime, but plain `next dev` runs on
Node.js, not workerd — even with `initOpenNextCloudflareForDev()` in `next.config.ts` (that hook
proxies explicit bindings like R2/KV, not ambient runtime globals like `caches`). Calling
`caches.default` under `next dev` throws `ReferenceError: caches is not defined`.

`getEdgeCache()` in `app/api/wishlist/route.ts` guards this with
`typeof caches === "undefined"` and returns `null`, and both the GET and POST handlers treat a
`null` cache as "skip caching, just hit R2 directly." Don't remove the guard, and don't assume
local dev behavior (no caching) matches production behavior (10s edge cache) when debugging
something that looks timing-related.

## TypeScript: `caches`/`CacheStorage` types conflict between DOM lib and Workers types

`tsconfig.json` includes `"lib": ["dom", ...]` (needed for React/client code), and
`lib.dom.d.ts` declares its own `CacheStorage` interface — one that lacks Workers' `.default`
property. The generated `cloudflare-env.d.ts` declares a *different*, Workers-flavored
`CacheStorage`, but TypeScript resolves `caches`'s type to the DOM lib's version, so
`caches.default` fails to typecheck even though it works fine at runtime. Worked around with a
local cast: `(caches as unknown as { default: Cache }).default`. If this ever needs touching
again, that's why the cast is there — it's not decorative.

## R2 needs the dashboard, not just the CLI, to get started

`wrangler r2 bucket create <name>` fails with `[code: 10042]` / "Please enable R2 through the
Cloudflare Dashboard" on an account that has never used R2 before, even for the free tier. This
is a one-time account-level toggle with no CLI or API equivalent — someone with dashboard access
has to click "Enable R2" once. After that, bucket creation and everything else works fine via
`wrangler`.

## Workers Builds CI "Deploy command" is separate from `wrangler.jsonc`

Cloudflare Workers Builds has dashboard-only Build/Deploy command settings that **do not read
from `wrangler.jsonc`**. If the Deploy command is the default (`npx wrangler deploy`) instead of
`npm run deploy`, the deploy step runs before `.open-next/` exists and fails with "Could not find
compiled Open Next config." Already happened once; fix was dashboard-only. See
`deployment.md`.

## Discord's edge blocks requests with no/generic `User-Agent`

Posting to a Discord webhook from a Worker with no `User-Agent` header (or a generic one) gets a
403 from Cloudflare's own edge in front of Discord (error 1010) — this is **not** specific to
`ptb.discord.com` vs `discord.com`, it's a bot-detection rule that fires on missing/generic UAs
regardless of host. `app/api/backup/route.ts` sets an explicit browser-like `User-Agent` on the
webhook `fetch()` call for this reason. Don't remove it.

## R2 reads can be *slower* than a third-party JSON API for tiny payloads

Don't assume "moved it onto Cloudflare's own network" automatically means "faster." Direct R2
reads through a Next.js Route Handler measured ~220-250ms vs. npoint.io's ~100-140ms for this
same small JSON blob — Route Handler overhead plus R2 not being edge-cached by default for small
objects. The actual fix was adding an edge cache layer (`caches.default`, 10s TTL, purged on every
write) in front of R2, not the R2 migration alone. See `storage.md`.

## Price strings must not contain decimals

`parsePrice()` strips everything except digits (`value.replace(/[^\d]/g, "")`), so `"49.99"`
becomes `4999`, not `49.99`. USD prices must be stored as whole-dollar strings (e.g. `"50"`, not
`"49.99"`) or the price displayed/converted will be 100x too large. This bit the Kaspi-figurine
import batch once — fixed by switching those items to whole-dollar strings, not by changing
`parsePrice()` (KZT prices legitimately have no decimals, and changing the parser to handle
decimals would need to disambiguate "150.000" thousands-separator-style KZT prices from genuine
decimals, which isn't worth the complexity for this app's scale).

## `isItemLocked()`, not `Boolean(item.reservedBy)`, is the "is this taken" check

A gift with `unlimitedReservation: true` can have a non-empty `reservedBy` (comma-joined guest
names) while still being open for more reservations. `isItemLocked(item)` correctly returns
`Boolean(item.reservedBy) && !item.unlimitedReservation`. Checking `reservedBy` truthiness alone
will incorrectly treat unlimited-reservation gifts as taken.
