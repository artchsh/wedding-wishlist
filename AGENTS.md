<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Wedding Wishlist — project notes

A wedding gift wishlist: guests reserve gifts by name at `/`, an admin manages inventory at
`/admin` (password-gated, see `ADMIN_PASSWORD` in `app/admin/admin-wishlist.tsx`). Deployed on
Cloudflare Workers via `@opennextjs/cloudflare`. Full details live in `docs/` — read
`docs/architecture.md` first if you're picking this project up cold. `docs/gotchas.md` covers
mistakes already made once; check it before re-making them.

## Storage model

Wishlist data is one JSON document (`WishlistDocument` in `app/wishlist-data.ts`) stored as a
single object in an R2 bucket, read/written **as a whole** (no partial updates) via
`app/api/wishlist/route.ts`. Every mutation — reserve, cancel, admin add/edit/delete, category
reorder — follows the same pattern: take the full `items` array, transform it client-side, then
call `replaceWishlist(items, categoryOrder)` which POSTs the entire document back. There is no
locking, so concurrent writes can race; this has been an accepted tradeoff so far. See
`docs/storage.md`.

## Critical: client vs. server fetch helpers

`fetchWishlist()` / `replaceWishlist()` / `triggerBackup()` / `parseKaspiUrl()` in
`app/wishlist-data.ts` all call **relative** URLs (`fetch("/api/wishlist")`). That only resolves
in a browser. **Never call these from server-side code** (Route Handlers, server components) —
it will throw `TypeError: Failed to parse URL`. Server-side code that needs the wishlist data
should import `readWishlistRaw()` from `app/api/wishlist/store.ts` and read the R2 binding
directly instead. This exact bug already broke `/api/backup` once — see `docs/gotchas.md`.

## Before touching deployment config

Read `docs/deployment.md` first. Cloudflare Workers Builds CI has a dashboard-configured
"Deploy command" that is **separate** from `wrangler.jsonc` and does not read build logic from
it — a previous deploy broke because of this and the fix had to be made in the dashboard, which
is not CLI-accessible. If a deploy fails with "Could not find compiled Open Next config", that's
this exact issue.

## Conventions

- All user-facing copy is in Russian, casual/informal tone (the actual couple's voice, including
  profanity in places) — match the existing tone, don't formalize it.
- Both guest and admin pages are `"use client"` components; there is no server-rendered data
  fetching path currently — everything fetches client-side after mount.
- Prices are stored as free-text strings (`WishlistItem.price`) with a separate `priceCurrency`
  ("KZT" | "USD"); `parsePrice()` strips non-digits, so never store decimals in the string (e.g.
  a $49.99 item must be stored as a whole-dollar amount or it parses as 4999).
- `isItemLocked(item)` — not `Boolean(item.reservedBy)` — is the correct check for "is this gift
  taken," since `unlimitedReservation` items stay open even when reserved by someone.
