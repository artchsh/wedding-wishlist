# Admin panel

`/admin` ([`app/admin/admin-wishlist.tsx`](../app/admin/admin-wishlist.tsx)) is gated by a
hardcoded password (`ADMIN_PASSWORD = "1508"`), checked client-side and remembered in
`localStorage` (`wedding-admin-unlocked`). This is **not real authentication** — anyone who reads
the client bundle can find the password, and `localStorage` isn't a session. It's intentionally
simple for a low-stakes, single-event use case. Don't treat it as a security boundary.

## Features

- **Add gift** — a form (`GiftFormFields`, shared between add and edit) with title, shop URL,
  image URL (with live preview), category (free text + datalist suggestions from existing
  categories), price + currency, delivery estimate, note, and an "allow multiple reservations"
  checkbox (`unlimitedReservation`).
- **Kaspi.kz auto-import** — paste a kaspi.kz product URL into the box above the add-gift form
  and click "Распознать" ("Recognize"). Calls `POST /api/parse-kaspi`, which fetches the page
  server-side and extracts the `schema.org Product` JSON-LD block (title, image, category,
  price) to prefill the form. Always review before saving — it's scraped, not guaranteed.
- **Edit / delete** — each `InventoryCard` toggles into an inline edit form (same
  `GiftFormFields` component, different state slice: `editForm` vs `form`). Delete requires a
  confirm step (`confirmDeleteId`).
- **Release reservation** — admin can clear `reservedBy` on any item without going through the
  guest reserve/cancel flow (useful if a guest can't access the site, or a reservation needs to
  be cleared manually).
- **Category order** ("Порядок секций") — up/down buttons reorder categories; this writes
  `categoryOrder` on the document, which both the guest and admin page read via
  `sortCategories()` to decide display order. Categories not in `categoryOrder` sort
  alphabetically (Russian collation) after the ordered ones, with "Другое" ("Other") always last.
- **Manual Discord backup** — "Отправить бэкап в Discord" button calls the same
  `triggerBackup()` helper that fires automatically after every save, for testing/on-demand use.

## Every mutation goes through `persist()`

Add, edit, delete, release, and category-reorder all funnel through one function,
`persist(nextItems, busyId, nextCategoryOrder)`, which:

1. POSTs the full document via `replaceWishlist()`
2. Updates local state on success
3. Fires `triggerBackup()` (fire-and-forget, not awaited) on success
4. Surfaces errors via `setError()`/`setStatus()`, never throws past this point

If you add a new mutation, route it through `persist()` rather than calling `replaceWishlist`
directly — that's what keeps the backup-on-every-write behavior consistent.

## Changing the password

It's a plain string constant — `ADMIN_PASSWORD` near the top of `admin-wishlist.tsx`. There's no
backing store or rotation mechanism; editing the constant and redeploying is the whole process.
