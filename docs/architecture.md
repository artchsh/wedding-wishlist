# Architecture

## Overview

Two client-rendered pages share one JSON document of gift items:

- **`/` (guest page)** — [`app/page.tsx`](../app/page.tsx) → [`app/guest-wishlist.tsx`](../app/guest-wishlist.tsx)
- **`/admin` (admin page)** — [`app/admin/page.tsx`](../app/admin/page.tsx) → [`app/admin/admin-wishlist.tsx`](../app/admin/admin-wishlist.tsx)

Both are `"use client"` components. There's no server-rendered data path — each page fetches the
wishlist after mount via helpers in [`app/wishlist-data.ts`](../app/wishlist-data.ts), then
re-fetches/re-renders on every mutation.

```
Browser (guest or admin page)
   │ fetchWishlist() / replaceWishlist()  — relative fetch, client-side only
   ▼
app/api/wishlist/route.ts  (GET / POST)
   │ readWishlistRaw() — app/api/wishlist/store.ts
   ▼
R2 bucket "wedding-wishlist-data", key "wishlist.json"
```

A separate path triggers after every successful write:

```
triggerBackup() (client) → POST /api/backup → readWishlistRaw() (direct R2 read)
   → Discord webhook (JSON file attachment)
```

And an admin-only path for importing gifts:

```
Admin pastes a kaspi.kz URL → POST /api/parse-kaspi → fetch the Kaspi page server-side
   → extract schema.org Product JSON-LD → prefill the add-gift form
```

## Data model

Defined in `app/wishlist-data.ts`:

```ts
type WishlistItem = {
  id: string;
  title: string;
  note: string;
  url: string;              // "shop" link shown to guests
  imageUrl: string;
  category: string;         // free text; "Другое" ("Other") is the fallback bucket
  price: string;             // free-text digits, e.g. "150 000" or "250" — see gotchas.md
  priceCurrency: "KZT" | "USD";
  deliveryEstimate: "" | "SHORT" | "LONG";
  reservedBy: string;        // guest name, or comma-joined names if unlimitedReservation
  unlimitedReservation: boolean; // true = many guests can reserve without locking the gift
  createdAt: string;         // ISO timestamp
};

type WishlistDocument = {
  items: WishlistItem[];
  categoryOrder?: string[]; // explicit category display order, admin-editable
  updatedAt?: string;
};
```

The whole `WishlistDocument` is read and written as a single blob — see
[`storage.md`](storage.md) for why and what that means for concurrent writes.

`normalizeWishlist()` / `normalizeItem()` defensively coerce whatever comes back from storage
into this shape, dropping items with no title and filling in defaults for missing fields. This is
what makes it safe to evolve the schema without a migration step — old documents missing a new
field just get the default.

## Key files

| File | Purpose |
|---|---|
| `app/wishlist-data.ts` | Types, normalization, price formatting/parsing, all client-side fetch helpers |
| `app/guest-wishlist.tsx` | Guest UI — browsing, reserving, cash/Kaspi option, reorder animations |
| `app/admin/admin-wishlist.tsx` | Admin UI — password gate, CRUD, category order, Kaspi import, manual backup |
| `app/api/wishlist/route.ts` | GET/POST the wishlist document; owns the edge-cache logic |
| `app/api/wishlist/store.ts` | Server-only raw R2 read, shared by the wishlist route and backup route |
| `app/api/backup/route.ts` | Reads R2 directly, POSTs the JSON to a Discord webhook as a file |
| `app/api/parse-kaspi/route.ts` | Fetches a kaspi.kz page server-side, extracts product JSON-LD |
| `components/ui/*` | shadcn/ui components (Card, Button, Badge, Input, etc.) |

## Frontend stack notes

- Tailwind v4 with `@theme inline` + OKLCH colors in `app/globals.css`; light/dark dual theme via
  `.dark` class (set on `<html>` in `app/layout.tsx`), `--font-*` variables all point at
  JetBrains Mono (unified mono/tech look across headings and body text).
- `motion` (the `framer-motion` successor package, imported as `motion/react`) drives the
  gift-card reorder animation: each card is a `motion.div` with `layout`, so when a reservation
  moves it to the end of its category (or back), it visually slides there via FLIP rather than
  teleporting. On narrow viewports the moved card also gets `scrollIntoView`'d via
  `onLayoutAnimationComplete`, since cards sit in a horizontally-swipeable row on mobile.
- `tw-animate-css` is imported in `globals.css` for utility animation classes; `.no-scrollbar` is
  a custom utility (also in `globals.css`) used to hide the scrollbar on that mobile swipe row.

## This is not the Next.js you know

See `AGENTS.md` / `node_modules/next/dist/docs/` — this project pins a Next.js version with
breaking changes from the version most training data assumes. Check the bundled docs before
assuming an API works the way you remember.
