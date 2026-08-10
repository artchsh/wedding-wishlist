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
  id: string;            // server-assigned
  name: string;          // trimmed, inner whitespace collapsed
  attending: boolean;
  submitterId: string;   // anonymous per-browser id, see "Submitter identity" below
  createdAt: string;     // server-assigned ISO timestamp
};

type RsvpDocument = {
  records: RsvpRecord[];
  resolutions: RsvpResolution[]; // see "Resolutions" below
  updatedAt?: string;
};
```

**Records are never modified or deleted.** `appendRsvp()` in
[`app/api/rsvp/store.ts`](../app/api/rsvp/store.ts) reads the current document, pushes one record,
and writes it back — that's the only mutation the log supports. A guest who changes their mind
submits again and gets a second record — see "Admin section" below for how those records turn
into a headcount.

`id` and `createdAt` are assigned server-side in the route handler, not sent by the client, so a
record can't be back-dated or spoofed.

Unlike `/api/wishlist`, `GET /api/rsvp` is **not** edge-cached — it's read by the admin page, where
a stale headcount would be worse than an extra 200ms. It responds with `Cache-Control: no-store`.

The same read-modify-write race as the wishlist applies (two submissions landing in the same
window can drop one). Same accepted tradeoff, same reasoning — see [`storage.md`](storage.md).

## Submitter identity

Every browser generates a UUID on first submission and keeps it in `localStorage` under
`wedding-rsvp-submitter`; it rides along on each record as `submitterId`. It identifies a browser,
not a person — no name, no fingerprint.

This is what lets the admin tell "one guest pressed the button seven times" from "two guests share a
name". `groupRsvpsByName()` buckets a name's records by `submitterId`; one bucket is one presumed
person contributing its own latest answer, and only two or more buckets raise a flag. Repeat answers
from one browser are never a warning — the row notes how many times the answer *flipped*
(`answerChanges`), and identical repeats count as zero.

Two browsers are flagged **even when they agree**: the answer is unambiguous but the headcount isn't.

## Resolutions

`rsvps.json` carries a second append-only array. A resolution records the couple's decision about one
name — `kind: "single"` (one person, this is their answer) or `kind: "split"` (this many coming, this
many not) — plus a free-text note. Written via `POST /api/rsvp/resolve`; never edited, never deleted,
newest per `nameKey` wins.

A resolution decides its name's contribution to the headcount outright. Without one, each browser
counts as one person.

`recordCount` stores how many records the group held when the decision was made. More records than
that means the resolution is **stale** — the group is flagged for another look, but the resolution
*keeps applying to the count*. An explicit human decision shouldn't silently revert to a guess
because someone tapped a button.

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

- **Headcount** — "N придут / M не придут". For each name (`groupRsvpsByName()` keys on the
  lowercased, whitespace-collapsed name, so "александр п." and "Александр П." are the same
  person), a resolution decides that name's contribution to the count outright; without one,
  every browser (`submitterId`) that answered under the name counts as one person, using that
  browser's latest answer (`countGroupPeople()` in [`app/rsvp-data.ts`](../app/rsvp-data.ts)).
- **Row states** — `RsvpGroupRow` in `admin-rsvp.tsx` renders one of four states per name:
  - *Clean*: one browser answered. Just the count badge.
  - *Changed their mind*: one browser, more than one answer. A muted "менял(а) ответ N раз" note
    (`answerChanges`, counts flips not records) — not a warning, no border colour.
  - *Needs review*: two or more browsers answered and there's no resolution yet
    (`group.needsReview && !group.resolution`). Destructive-red border, a "Ответы с N устройств"
    badge, and the raw records expanded below, grouped per device ("Устройство 1", "Устройство
    2", ...). Two buttons appear: «Это один человек» and «Разные люди».
  - *Resolved*: a resolution exists for the name. Shows "Решено: ..." with the decision and note.
    The border is plain unless more records have arrived since the decision was made
    (`resolutionStale`), in which case it turns amber with a "После решения пришли новые ответы"
    badge — the resolution still decides the headcount, it's just flagged for another look. The
    two resolve buttons stay available whenever the name still has 2+ devices, so the couple can
    re-resolve after new answers come in.
- **Resolve controls** — «Это один человек» opens a form to pick придёт/не придёт plus an optional
  note; «Разные люди» opens two number inputs (how many coming, how many not — at least two people
  total) plus a note. Both are inline on the row, and both call `submitRsvpResolution()` →
  `POST /api/rsvp/resolve`, which appends a new `RsvpResolution` — never edits or deletes a past
  one.

The review flag exists because two real guests can legitimately share one name string, and the
couple reconciles that against their own guest list. There's a lightweight resolve UI — pick "one
person" or "different people" and write a note — but deliberately no per-record assignment to
named individuals: the couple eyeballs the raw records grouped by device and makes the call.

There's also a manual "Бэкап в Discord" button, mirroring the wishlist's.
