# RSVP

A second, independent flow next to the gift wishlist: guests say whether they're coming at
[`/rsvp`](../app/rsvp/page.tsx), the couple reads the headcount in the RSVP section of `/admin`.

The two flows share nothing but the R2 bucket and the nav bar. In particular the **identity is
different**: the wishlist uses a throwaway nickname (`wedding-wishlist-guest-name` in
`localStorage`), RSVP uses the guest's real name in "first name + surname initial" format
(`wedding-rsvp-name`). Don't merge them.

## Guest page

[`app/rsvp/guest-rsvp.tsx`](../app/rsvp/guest-rsvp.tsx) — one text input and two buttons ("Я
приду" / "Я не приду"). No plus-ones, no meal choices, no extra fields.

The name format is Kaspi-transfer style: `Александр П.`. `validateRsvpName()` in
[`app/rsvp-data.ts`](../app/rsvp-data.ts) enforces it lightly — the name must contain a space with
at least one letter after it. Both buttons are disabled while the name doesn't match, and the hint
under the input turns into the error message once the field has been touched. The same validator
runs again in the route handler, so a hand-crafted POST can't bypass it.

## Append-only storage

The log is one JSON document at key `rsvps.json` in the same R2 bucket as `wishlist.json`
(`WISHLIST_BUCKET`) — no new binding, nothing to add to `wrangler.jsonc`.

```ts
type RsvpRecord = {
  id: string;         // server-assigned
  name: string;       // trimmed, inner whitespace collapsed
  attending: boolean;
  createdAt: string;  // server-assigned ISO timestamp
};

type RsvpDocument = { records: RsvpRecord[]; updatedAt?: string };
```

**Records are never modified or deleted.** `appendRsvp()` in
[`app/api/rsvp/store.ts`](../app/api/rsvp/store.ts) reads the current document, pushes one record,
and writes it back — that's the only mutation the log supports. A guest who changes their mind
submits again and gets a second record; the headcount uses the latest one per name.

`id` and `createdAt` are assigned server-side in the route handler, not sent by the client, so a
record can't be back-dated or spoofed.

Unlike `/api/wishlist`, `GET /api/rsvp` is **not** edge-cached — it's read by the admin page, where
a stale headcount would be worse than an extra 200ms. It responds with `Cache-Control: no-store`.

The same read-modify-write race as the wishlist applies (two submissions landing in the same
window can drop one). Same accepted tradeoff, same reasoning — see [`storage.md`](storage.md).

## Discord backup

Every successful submit fires `triggerRsvpBackup()` → `POST /api/backup/rsvp`, which reads
`rsvps.json` straight from R2 and posts it to the Discord webhook as a file attachment
(`rsvp-backup-<ts>.json`). Fire-and-forget, exactly like the wishlist's `triggerBackup()`.

Both backup routes share [`app/api/backup/discord.ts`](../app/api/backup/discord.ts)
(`sendDiscordBackup()`), which owns the multipart payload, the browser-like `User-Agent` Discord's
edge requires, and the error mapping. Don't post to the webhook directly from a new route — use
the helper.

## Admin section

[`app/admin/admin-rsvp.tsx`](../app/admin/admin-rsvp.tsx) renders below the gift inventory on
`/admin`, behind the same password gate. It fetches `/api/rsvp` on mount and derives everything
client-side:

- **Headcount** — "N придут / M не придут", counted from the *latest* record per unique name
  (`groupRsvpsByName()` keys on the lowercased, whitespace-collapsed name, so "александр п." and
  "Александр П." are the same person).
- **Duplicate flag** — any name with more than one submission gets an amber border and its full
  record list expanded inline. If those submissions disagree about coming vs. not coming, the
  border turns destructive-red and the badge says so.

The duplicate flag exists because two real guests can legitimately share one name string. There is
deliberately **no merge UI** — the couple knows their guest list, so surfacing the raw records for
a flagged name and letting them eyeball it is enough.

There's also a manual "Бэкап в Discord" button, mirroring the wishlist's.
