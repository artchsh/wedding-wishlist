# RSVP duplicate & conflict resolution — design

**Date:** 2026-08-10
**Status:** approved, not yet implemented
**Touches:** `app/rsvp-data.ts`, `app/rsvp/guest-rsvp.tsx`, `app/api/rsvp/*`, `app/admin/admin-rsvp.tsx`

## Problem

The RSVP log is append-only, and the admin groups records by name. Any name with more than one
record is flagged; if those records disagree, the flag turns red ("Ответы противоречат друг другу").

That flag was built for one situation — two real guests sharing a name string — but it fires on a
completely different and far more common one: a single person pressing the buttons repeatedly. A
real submission produced seven records for "Салима Е." within three minutes, alternating answers,
which rendered as a red conflict.

The two situations are indistinguishable in the data as stored. Consequences:

- The signal is worthless. If two real Салимы ever do collide, it will look exactly like the noise.
- The history block is unreadable — seven near-identical lines the couple must scan.
- There is nothing the couple can do about a flag except remember they looked at it. The flag
  returns every time the page loads.

## Goals

1. A single person answering many times must not produce a warning of any kind.
2. The couple can record a decision about an ambiguous name, and that decision sticks and drives
   the headcount.
3. New answers arriving after a decision reopen it for another look, git-merge style.
4. No records are ever modified or deleted. The log stays append-only.

## Non-goals

- Assigning individual records to individually named people ("Салима Е. (кузина)").
- Editing or deleting submissions from the admin.
- Server-side authentication on the new endpoint. `/admin` is a client-side password gate and
  `docs/admin.md` already documents it as not a security boundary; adding real auth to one route
  would be inconsistent theatre.
- Preventing or rate-limiting repeat submissions. Storage is cheap, the log is the audit trail, and
  the fix belongs in grouping and display, not in refusing writes.

## Part 1 — Submitter identity

### Data

`RsvpRecord` gains one field:

```ts
type RsvpRecord = {
  id: string;
  name: string;
  attending: boolean;
  submitterId: string;   // NEW — anonymous per-browser id, "" for legacy records
  createdAt: string;
};
```

`submitterId` is a UUID generated once per browser and kept in `localStorage` under
`wedding-rsvp-submitter`. It identifies a browser, not a person: no name, no fingerprint, nothing
derived from the device. It is sent in the POST body; unlike `id`/`createdAt` it cannot be assigned
server-side, since the whole point is that it persists across submissions from one client.

`normalizeRecord()` coerces a missing or non-string value to `""`, so existing documents load
unchanged — this is the same schema-evolution-by-normalization the wishlist already relies on.

### Grouping

`groupRsvpsByName()` gains a second level. Within a name group, records are bucketed by
`submitterId`, with **all `""` values sharing one bucket** (see "Legacy records" below).

Each bucket is a presumed person contributing its own latest answer:

```ts
type RsvpSubmitter = {
  submitterId: string;      // "" for the legacy bucket
  records: RsvpRecord[];    // oldest first
  latest: RsvpRecord;
};

type RsvpNameGroup = {
  key: string;
  name: string;
  records: RsvpRecord[];       // all records for the name, oldest first
  submitters: RsvpSubmitter[]; // NEW
  latest: RsvpRecord;
  answerChanges: number;       // NEW — times the answer flipped within a single submitter
  needsReview: boolean;        // REPLACES duplicated/conflicting — 2+ submitters
  resolution: RsvpResolution | null;  // NEW, see Part 2
  resolutionStale: boolean;           // NEW, see Part 2
};
```

`duplicated` and `conflicting` are removed. `answerChanges` counts **flips**, not records — five
identical "придёт" submissions from one browser are zero changes and read as clean, because nothing
about them is interesting to the couple. It carries no warning styling in any case; `needsReview` is
the only thing that raises a flag.

`needsReview` fires on two submitters **even when they agree**. Two devices saying "придёт" is
either one person answering twice or two guests who are both coming — the answer is unambiguous but
the headcount is not, and the headcount is the thing the couple actually needs. This is a deliberate
departure from the old rule, where matching answers were treated as harmless.

### Legacy records

Every record currently in production has `submitterId: ""`. Bucketing them together means a name
with only legacy records is always treated as one person, and the existing seven-record Салима Е.
group resolves to "придёт" (its latest answer) with no flag, immediately, with no migration step.

The trade: if two real guests both answered before this ships, they silently count as one until one
of them answers again from a browser that has an id. Accepted — the log is three days old and the
duplicates in it are known to be one person messing around. Documented here so it isn't discovered
as a surprise later.

## Part 2 — Resolutions

### Data

A second append-only array in the same document:

```ts
type RsvpResolution = {
  id: string;             // server-assigned
  nameKey: string;        // rsvpNameKey() of the name this applies to
  kind: "single" | "split";
  attending: boolean;     // kind "single": the answer that counts. Ignored when "split".
  coming: number;         // kind "split": how many of these people are coming. 0 when "single".
  notComing: number;      // kind "split": how many are not. 0 when "single".
  note: string;           // free text, may be empty
  recordCount: number;    // records in the group at resolve time — the merge base
  createdAt: string;      // server-assigned
};

type RsvpDocument = {
  records: RsvpRecord[];
  resolutions: RsvpResolution[];   // NEW, defaults to [] when absent
  updatedAt?: string;
};
```

All fields are always present — `attending`, `coming`, `notComing` take zero values for the kind
that doesn't use them, so consumers never branch on `undefined`.

Resolutions are never edited or deleted. Changing your mind appends another one for the same
`nameKey`; the newest by `createdAt` wins. This mirrors the records rule exactly, and keeps the
decision history in the Discord backups.

### Headcount

For each name group, in order:

1. If a resolution exists — it decides. `kind: "single"` contributes one person with
   `attending`. `kind: "split"` contributes `coming + notComing` people.
2. Otherwise — automatic. Each submitter bucket contributes one person with that bucket's latest
   answer.

So a two-device group with no resolution already counts as two people. That is the honest default:
two devices probably means two people, and the flag asks the couple to confirm rather than to
supply a number the code guessed at.

### Staleness (the git part)

`recordCount` is the merge base. A resolution is stale when the group now holds more records than
it did at resolve time.

A stale resolution **still applies to the headcount** — it's an explicit human decision, and
silently reverting to a guess because someone tapped a button would be worse than being slightly out
of date. The group is flagged for another look, and resolving again clears it by recording the new
count.

## Part 3 — API

New route `POST /api/rsvp/resolve`:

- Body: `{ nameKey, kind, attending?, coming?, notComing?, note? }`.
- Validates: `nameKey` non-empty; `kind` one of the two; for `"split"`, `coming` and `notComing`
  are non-negative integers summing to at least 2 (a split into fewer than two people is a
  `"single"`); `note` trimmed, capped at 200 characters.
- Assigns `id` and `createdAt` server-side, appends via a new `appendResolution()` in
  `app/api/rsvp/store.ts` — same read-modify-write shape as `appendRsvp()`, same race caveat.
- Returns `{ ok: true, resolution }`.

`GET /api/rsvp` returns the document as it now stands, so it carries `resolutions` with no change.

The admin fires the existing `triggerRsvpBackup()` after a successful resolve, so decisions land in
Discord like everything else.

## Part 4 — Admin UI

Four row states in `app/admin/admin-rsvp.tsx`:

| State | Condition | Appearance |
|---|---|---|
| Clean | one submitter, `answerChanges === 0` | name, answer badge, timestamp — unchanged, however many identical records sit behind it |
| Changed their mind | one submitter, `answerChanges > 0` | adds muted «менял(а) ответ N раз», history collapsed behind it. No colour, no icon. |
| Needs review | `needsReview`, unresolved | amber border, records grouped under «Устройство 1 / 2 / …», resolve controls |
| Resolved | `resolution` present | neutral badge with the decision and note, «Изменить решение». Amber + «после решения пришли новые ответы» when stale. |

Resolve controls are inline in the card — no modal, no drag-and-drop:

- **«Это один человек»** — reveals the distinct answers as a two-way choice, latest preselected, plus
  an optional note. Save appends a `"single"` resolution.
- **«Разные люди»** — reveals two small number inputs (придут / не придут), prefilled from the
  submitter buckets' latest answers, plus an optional note. Save appends a `"split"` resolution.

The summary line gains the count of groups needing review, replacing today's "N имён с несколькими
ответами" (which counted the noise this design eliminates).

## Error handling

- Resolve request fails → inline error in the card, controls stay open with the entered values, the
  group stays unresolved. Nothing is lost.
- Backup fails after a successful resolve → silent, fire-and-forget, exactly as gift reservations
  and RSVP submissions already behave.
- Corrupt or unparseable `resolutions` → `normalizeRsvps()` drops the bad entries and keeps the
  records, same defensive posture as `normalizeItem()`. A dropped resolution reopens its group; it
  does not lose an answer.
- Two admins resolving at once → last write wins, same accepted race as every other write in this
  app. See `docs/storage.md`.

## Testing

No test framework exists in this project, so verification is manual, against local emulated R2:

1. Submit the same answer twice from one browser → one clean row, no note, headcount 1. Then submit
   the opposite answer → «менял(а) ответ 1 раз», still no colour, headcount 1.
2. Submit under the same name from a second browser profile → needs-review, two device buckets,
   headcount 2.
3. Resolve as «один человек» → headcount 1, decision shown, flag cleared.
4. Submit again from a third profile → stale badge, headcount still 1.
5. Re-resolve as «разные люди» 2/1 → headcount 3, stale cleared, both resolutions present in the
   stored document.
6. Reload → every state above survives, since all of it is derived from the document.
7. Existing production-shaped records (no `submitterId`) → one row, no flag.

`npx tsc --noEmit`, `npm run lint`, and `npm run build` must pass.

## Documentation

`docs/rsvp.md` gains a section covering submitter identity, the resolution model, and the staleness
rule. `AGENTS.md`'s append-only note extends to resolutions. The legacy-bucket trade-off above goes
in `docs/gotchas.md` — it is exactly the kind of thing that looks like a bug a year from now.
