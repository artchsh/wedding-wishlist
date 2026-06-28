# Wedding Wishlist

A small Next.js app for managing a wedding gift wishlist: guests browse gifts and reserve them
by name, and a password-gated admin panel manages the inventory. Deployed on Cloudflare Workers.

- **Guest page** (`/`): browse gifts by category, reserve/cancel, or send cash via Kaspi transfer.
- **Admin page** (`/admin`): add/edit/delete gifts, reorder categories, auto-import a gift from a
  Kaspi.kz product link, and trigger a manual Discord backup.

For the full architecture, deployment process, and known gotchas, see [`docs/`](docs/) —
start with [`docs/architecture.md`](docs/architecture.md).

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui (Radix primitives)
- `motion` (Framer Motion successor) for card-reorder animations
- Cloudflare Workers via `@opennextjs/cloudflare` (OpenNext adapter) + Wrangler
- Cloudflare R2 for data storage, Cloudflare's edge Cache API for read caching
- Discord webhook for JSON backups after every write

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the guest page, `/admin` for the admin
panel (password is in `app/admin/admin-wishlist.tsx`, `ADMIN_PASSWORD`).

### Environment variables

Copy `.env.example` to `.env.local` and fill in a Discord webhook URL if you want backups to work
locally:

```bash
cp .env.example .env.local
```

Local dev reads R2 from a **local, empty** emulated bucket (separate from production) — the
guest/admin pages will show no gifts until you add some through `/admin`, which is expected.

### Type-checking and linting

```bash
npx tsc --noEmit
npm run lint
```

## Deploying

Pushing to `master` triggers Cloudflare Workers Builds, which builds and deploys automatically.
To deploy manually:

```bash
npm run deploy
```

See [`docs/deployment.md`](docs/deployment.md) for the one-time Cloudflare setup (R2 bucket,
secrets) and CI configuration details.

## Project structure

```
app/
  page.tsx                  Guest page (renders GuestWishlist)
  guest-wishlist.tsx         Guest UI: browse, reserve, cancel, animations
  admin/
    page.tsx                Admin page (renders AdminWishlist)
    admin-wishlist.tsx       Admin UI: CRUD, category order, Kaspi import, backups
  wishlist-data.ts          Shared types, normalization, client-side fetch helpers
  api/
    wishlist/route.ts        GET/POST the wishlist JSON (R2-backed, edge-cached)
    wishlist/store.ts         Server-only R2 read helper (shared by wishlist + backup routes)
    backup/route.ts          POSTs the current wishlist JSON to Discord as a file
    parse-kaspi/route.ts      Scrapes a Kaspi.kz product page for title/price/image/category
scripts/
  scrape-products.py         Playwright scraper used to bulk-import gifts from ITEMS_URLS.md
docs/                        Architecture, storage, deployment, admin, and gotchas docs
```
