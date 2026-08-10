# RSVP Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop flagging one guest who answers repeatedly, and give the couple a git-style resolve action for the names that are genuinely ambiguous.

**Architecture:** Each browser carries an anonymous `submitterId` in `localStorage` that rides along with every submission, so a name group can be split into "presumed people" instead of a flat record list. On top of that, an append-only `resolutions` array records the couple's decision about a name; the newest resolution per name wins, and it goes stale when new answers arrive after it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 + shadcn/ui, Cloudflare Workers + R2 via `@opennextjs/cloudflare`. Tests run on Node's built-in runner (`node --test`) against `.ts` sources directly — Node 24 strips types natively, so no test framework, transpiler, or new dependency is added.

**Spec:** [`docs/superpowers/specs/2026-08-10-rsvp-conflict-resolution-design.md`](../specs/2026-08-10-rsvp-conflict-resolution-design.md)

## Global Constraints

- All user-facing copy is Russian, casual/informal — match the existing tone, don't formalize it.
- Records and resolutions are append-only. Never modify or delete an existing entry; a change appends a new entry and the newest wins.
- `id` and `createdAt` are assigned server-side. `submitterId` is the one client-supplied identifier, because it must persist across submissions from one browser.
- Client helpers in `app/rsvp-data.ts` use relative `fetch()` and are **client-only**. Server code reads R2 through `app/api/rsvp/store.ts`. Never call one from the other — see `docs/gotchas.md`.
- Missing fields on stored documents are filled by `normalizeRsvps()`, never by a migration script.
- Every task must leave `npx tsc --noEmit`, `npm run lint`, and `npm run build` passing.
- Commit messages: imperative sentence case, no `feat:`/`fix:` prefixes (match existing history).

---

### Task 1: Test harness

Adds Node's built-in test runner so the pure logic in `app/rsvp-data.ts` can be developed test-first. No new dependencies. Ends with one passing test that pins current behaviour.

**Files:**
- Modify: `tsconfig.json` (add `allowImportingTsExtensions`)
- Modify: `package.json` (add `test` script)
- Create: `tests/rsvp-data.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs every `tests/**/*.test.ts`. Later tasks add tests to `tests/rsvp-data.test.ts`.

- [ ] **Step 1: Allow `.ts` import specifiers**

Node requires the explicit `.ts` extension in import paths; TypeScript rejects it unless this flag is on. It is only legal alongside `noEmit`, which this project already sets.

In `tsconfig.json`, add one line to `compilerOptions` after `"noEmit": true,`:

```json
    "allowImportingTsExtensions": true,
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"` after `"lint": "eslint",`:

```json
    "test": "node --test \"tests/**/*.test.ts\"",
```

The glob must stay quoted — Node expands it itself, and `node --test tests/` fails with `MODULE_NOT_FOUND` on this Node version.

- [ ] **Step 3: Write the first test**

Create `tests/rsvp-data.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRsvpsByName, rsvpNameKey } from "../app/rsvp-data.ts";

function record(
  name: string,
  attending: boolean,
  createdAt: string,
  submitterId = ""
) {
  return { id: `${name}-${createdAt}`, name, attending, submitterId, createdAt };
}

test("groups records that differ only by case and spacing", () => {
  const groups = groupRsvpsByName([
    record("Салима Е.", true, "2026-08-10T10:00:00.000Z"),
    record("салима   е.", false, "2026-08-10T10:01:00.000Z"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, rsvpNameKey("Салима Е."));
  assert.equal(groups[0].records.length, 2);
});

test("the newest record is the group's latest answer", () => {
  const groups = groupRsvpsByName([
    record("Тимур Б.", false, "2026-08-10T10:05:00.000Z"),
    record("Тимур Б.", true, "2026-08-10T10:09:00.000Z"),
  ]);

  assert.equal(groups[0].latest.attending, true);
});
```

The `submitterId` field on the helper is unused by the current implementation and ignored by it — Task 2 gives it meaning without touching these tests.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 2` / `ℹ fail 0`.

If you see `Cannot find module '.../tests'`, the glob in Step 2 lost its quotes.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc silent; lint reports only the 3 pre-existing warnings (`openCount` unused in `app/guest-wishlist.tsx`, two unused eslint-disable directives in `cloudflare-env.d.ts`). Zero errors.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json package.json tests/rsvp-data.test.ts
git commit -m "Add a Node test runner harness for the RSVP logic"
```

---

### Task 2: Record who submitted

Adds the anonymous per-browser id to the record shape, generates it on the guest page, and stores it. Grouping still ignores it — that's Task 3.

**Files:**
- Modify: `app/rsvp-data.ts` (type, `normalizeRecord`, new `getSubmitterId`, `submitRsvp`)
- Modify: `app/api/rsvp/route.ts` (accept and persist `submitterId`)
- Modify: `tests/rsvp-data.test.ts` (append tests)

**Interfaces:**
- Consumes: `npm test` from Task 1.
- Produces: `RsvpRecord.submitterId: string` (`""` when unknown); `getSubmitterId(): string` (client-only, reads/creates `localStorage["wedding-rsvp-submitter"]`); `submitRsvp` sends `submitterId` in the POST body.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rsvp-data.test.ts`:

```ts
import { normalizeRsvps } from "../app/rsvp-data.ts";

test("normalizes a missing submitterId to an empty string", () => {
  const document = normalizeRsvps({
    records: [
      {
        id: "a",
        name: "Салима Е.",
        attending: true,
        createdAt: "2026-08-10T10:00:00.000Z",
      },
    ],
  });

  assert.equal(document.records[0].submitterId, "");
});

test("keeps a submitterId that is present", () => {
  const document = normalizeRsvps({
    records: [
      {
        id: "a",
        name: "Салима Е.",
        attending: true,
        submitterId: "device-1",
        createdAt: "2026-08-10T10:00:00.000Z",
      },
    ],
  });

  assert.equal(document.records[0].submitterId, "device-1");
});
```

Move the `import { normalizeRsvps }` up into the existing import from `"../app/rsvp-data.ts"` rather than adding a second import statement from the same module.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — 2 failing tests, both `AssertionError` reporting `undefined !== ''` / `undefined !== 'device-1'`, because `RsvpRecord` has no such field yet.

- [ ] **Step 3: Add the field to the type and normalizer**

In `app/rsvp-data.ts`, add `submitterId` to the type:

```ts
export type RsvpRecord = {
  id: string;
  name: string;
  attending: boolean;
  /** Anonymous per-browser id. "" for records written before this existed. */
  submitterId: string;
  createdAt: string;
};
```

And in `normalizeRecord`, add the field to the returned object between `attending` and `createdAt`:

```ts
    attending: record.attending === true,
    submitterId:
      typeof record.submitterId === "string" ? record.submitterId : "",
    createdAt:
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 4` / `ℹ fail 0`.

- [ ] **Step 5: Generate the id on the client**

In `app/rsvp-data.ts`, add above `fetchRsvps`:

```ts
const SUBMITTER_STORAGE_KEY = "wedding-rsvp-submitter";

/**
 * Anonymous id for this browser, created on first use. Identifies a device, not
 * a person — it carries no name and nothing derived from the device. Client-only:
 * it reads localStorage.
 */
export function getSubmitterId() {
  const existing = window.localStorage.getItem(SUBMITTER_STORAGE_KEY);

  if (existing) return existing;

  const created = crypto.randomUUID();
  window.localStorage.setItem(SUBMITTER_STORAGE_KEY, created);

  return created;
}
```

Then send it from `submitRsvp` — replace its `body:` line with:

```ts
      body: JSON.stringify({ name, attending, submitterId: getSubmitterId() }),
```

- [ ] **Step 6: Persist it server-side**

In `app/api/rsvp/route.ts`, inside `POST`, replace the `const record: RsvpRecord = {` block with:

```ts
  // id and createdAt are assigned server-side so a record can't be back-dated or
  // spoofed from the client. submitterId is the exception: only the client can
  // know which browser this is, and it has to stay stable across submissions.
  const record: RsvpRecord = {
    id: crypto.randomUUID(),
    name: normalizeRsvpName(rawName),
    attending: body.attending,
    submitterId:
      typeof body.submitterId === "string"
        ? body.submitterId.slice(0, 100)
        : "",
    createdAt: new Date().toISOString(),
  };
```

- [ ] **Step 7: Verify the route end to end**

Start the dev server, with the Discord webhook disabled so local testing can't post to the couple's real channel:

```bash
DISCORD_WEBHOOK_URL= npm run dev
```

Note the port it prints (3000, or 3001 if 3000 is taken) and use it below.

```bash
curl -s -X POST http://localhost:3000/api/rsvp -H "Content-Type: application/json" -d '{"name":"Test A.","attending":true,"submitterId":"device-1"}'
```

Expected: `{"ok":true,"record":{...,"submitterId":"device-1",...}}`

```bash
curl -s -X POST http://localhost:3000/api/rsvp -H "Content-Type: application/json" -d '{"name":"Test B.","attending":true}'
```

Expected: `{"ok":true,"record":{...,"submitterId":"",...}}` — a client that sends nothing still succeeds.

- [ ] **Step 8: Verify the guest page sends it**

Open `/rsvp`, submit a valid name, then in the browser console run `localStorage.getItem("wedding-rsvp-submitter")`.
Expected: a UUID string. Submit again and confirm via `curl -s http://localhost:3000/api/rsvp` that both records carry that same id.

- [ ] **Step 9: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass; the route list still shows `/rsvp`, `/api/rsvp`, `/api/backup/rsvp`.

- [ ] **Step 10: Commit**

```bash
git add app/rsvp-data.ts app/api/rsvp/route.ts tests/rsvp-data.test.ts
git commit -m "Record an anonymous per-browser id with every RSVP answer"
```

---

### Task 3: Group by submitter, not by record

Replaces the `duplicated`/`conflicting` flags with a two-level grouping. This is the task that makes the seven-record Салима Е. group stop being a warning.

**Files:**
- Modify: `app/rsvp-data.ts` (`RsvpNameGroup`, new `RsvpSubmitter`, `groupRsvpsByName`, `summarizeRsvps`)
- Modify: `app/admin/admin-rsvp.tsx` (adapt to the new fields — full restyling is Task 6)
- Modify: `tests/rsvp-data.test.ts`

**Interfaces:**
- Consumes: `RsvpRecord.submitterId` from Task 2.
- Produces:
  - `type RsvpSubmitter = { submitterId: string; records: RsvpRecord[]; latest: RsvpRecord }`
  - `RsvpNameGroup` gains `submitters: RsvpSubmitter[]`, `answerChanges: number`, `needsReview: boolean`; loses `duplicated` and `conflicting`.
  - `countGroupPeople(group): { coming: number; notComing: number }`
  - `summarizeRsvps(groups)` returns `{ coming, notComing, people, names, needsReview }` — note `people` is now the headcount total, and `names` is the group count that `people` used to hold.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rsvp-data.test.ts`:

```ts
import { countGroupPeople, summarizeRsvps } from "../app/rsvp-data.ts";

test("one browser answering seven times is one person and no flag", () => {
  const [group] = groupRsvpsByName([
    record("Салима Е.", false, "2026-08-10T14:09:00.000Z", "device-1"),
    record("Салима Е.", true, "2026-08-10T14:09:30.000Z", "device-1"),
    record("Салима Е.", true, "2026-08-10T14:10:00.000Z", "device-1"),
    record("Салима Е.", false, "2026-08-10T14:11:00.000Z", "device-1"),
    record("Салима Е.", true, "2026-08-10T14:11:30.000Z", "device-1"),
  ]);

  assert.equal(group.submitters.length, 1);
  assert.equal(group.needsReview, false);
  assert.equal(group.answerChanges, 3);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 0 });
});

test("repeating the same answer is not a change of mind", () => {
  const [group] = groupRsvpsByName([
    record("Тимур Б.", true, "2026-08-10T10:00:00.000Z", "device-1"),
    record("Тимур Б.", true, "2026-08-10T10:01:00.000Z", "device-1"),
    record("Тимур Б.", true, "2026-08-10T10:02:00.000Z", "device-1"),
  ]);

  assert.equal(group.answerChanges, 0);
  assert.equal(group.needsReview, false);
});

test("two browsers under one name need review and count as two people", () => {
  const [group] = groupRsvpsByName([
    record("Алия К.", true, "2026-08-10T10:00:00.000Z", "device-1"),
    record("Алия К.", false, "2026-08-10T10:01:00.000Z", "device-2"),
  ]);

  assert.equal(group.submitters.length, 2);
  assert.equal(group.needsReview, true);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 1 });
});

test("two browsers that agree still need review, because the count is ambiguous", () => {
  const [group] = groupRsvpsByName([
    record("Данияр Т.", true, "2026-08-10T10:00:00.000Z", "device-1"),
    record("Данияр Т.", true, "2026-08-10T10:01:00.000Z", "device-2"),
  ]);

  assert.equal(group.needsReview, true);
  assert.deepEqual(countGroupPeople(group), { coming: 2, notComing: 0 });
});

test("legacy records with no submitterId share one bucket", () => {
  const [group] = groupRsvpsByName([
    record("Айгерим С.", true, "2026-08-10T10:00:00.000Z"),
    record("Айгерим С.", false, "2026-08-10T10:01:00.000Z"),
    record("Айгерим С.", true, "2026-08-10T10:02:00.000Z"),
  ]);

  assert.equal(group.submitters.length, 1);
  assert.equal(group.needsReview, false);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 0 });
});

test("the summary totals people, not names", () => {
  const summary = summarizeRsvps(
    groupRsvpsByName([
      record("Алия К.", true, "2026-08-10T10:00:00.000Z", "device-1"),
      record("Алия К.", false, "2026-08-10T10:01:00.000Z", "device-2"),
      record("Тимур Б.", true, "2026-08-10T10:02:00.000Z", "device-3"),
    ])
  );

  assert.equal(summary.coming, 2);
  assert.equal(summary.notComing, 1);
  assert.equal(summary.people, 3);
  assert.equal(summary.names, 2);
  assert.equal(summary.needsReview, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `countGroupPeople` and `summary.names` are not exported/defined, and `group.submitters` is `undefined`.

- [ ] **Step 3: Implement the two-level grouping**

In `app/rsvp-data.ts`, replace the whole block from `export type RsvpNameGroup = {` through the end of `summarizeRsvps` with:

```ts
/** One presumed person within a name group: everything from a single browser. */
export type RsvpSubmitter = {
  /** "" is the shared bucket for records written before submitter ids existed. */
  submitterId: string;
  /** Oldest first. */
  records: RsvpRecord[];
  latest: RsvpRecord;
};

export type RsvpNameGroup = {
  key: string;
  /** Display name taken from the most recent submission for this key. */
  name: string;
  /** Every submission for this name, oldest first. */
  records: RsvpRecord[];
  /** One entry per distinct browser that answered under this name. */
  submitters: RsvpSubmitter[];
  /** The most recent submission across all submitters. */
  latest: RsvpRecord;
  /** How many times an answer flipped within a single browser. Not a warning. */
  answerChanges: number;
  /** Two or more browsers answered under this name — the couple must look. */
  needsReview: boolean;
};

/**
 * Groups the append-only log by name, then by browser. Two real guests can share
 * one name string, so a name answered from several browsers is flagged for manual
 * review instead of being merged automatically. Repeat answers from one browser
 * are one person, however many times they changed their mind.
 */
export function groupRsvpsByName(records: RsvpRecord[]): RsvpNameGroup[] {
  const groups = new Map<string, RsvpRecord[]>();

  for (const record of records) {
    const key = rsvpNameKey(record.name);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return Array.from(groups.entries())
    .map(([key, groupRecords]) => {
      const sorted = sortByCreatedAt(groupRecords);
      const latest = sorted[sorted.length - 1];
      const submitters = groupBySubmitter(sorted);

      return {
        key,
        name: latest.name,
        records: sorted,
        submitters,
        latest,
        answerChanges: submitters.reduce(
          (total, submitter) => total + countAnswerFlips(submitter.records),
          0
        ),
        needsReview: submitters.length > 1,
      };
    })
    .sort(
      (first, second) =>
        toTime(second.latest.createdAt) - toTime(first.latest.createdAt)
    );
}

function groupBySubmitter(sorted: RsvpRecord[]): RsvpSubmitter[] {
  const buckets = new Map<string, RsvpRecord[]>();

  for (const record of sorted) {
    const key = record.submitterId;
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  }

  return Array.from(buckets.entries()).map(([submitterId, bucketRecords]) => ({
    submitterId,
    records: bucketRecords,
    latest: bucketRecords[bucketRecords.length - 1],
  }));
}

/** Counts flips, not records: five identical answers in a row is zero changes. */
function countAnswerFlips(records: RsvpRecord[]) {
  let flips = 0;

  for (let index = 1; index < records.length; index += 1) {
    if (records[index].attending !== records[index - 1].attending) {
      flips += 1;
    }
  }

  return flips;
}

function sortByCreatedAt(records: RsvpRecord[]) {
  return [...records].sort(
    (first, second) => toTime(first.createdAt) - toTime(second.createdAt)
  );
}

/** How many people this name contributes to the headcount, and their answers. */
export function countGroupPeople(group: RsvpNameGroup) {
  let coming = 0;
  let notComing = 0;

  for (const submitter of group.submitters) {
    if (submitter.latest.attending) {
      coming += 1;
    } else {
      notComing += 1;
    }
  }

  return { coming, notComing };
}

export function summarizeRsvps(groups: RsvpNameGroup[]) {
  let coming = 0;
  let notComing = 0;

  for (const group of groups) {
    const counts = countGroupPeople(group);
    coming += counts.coming;
    notComing += counts.notComing;
  }

  return {
    coming,
    notComing,
    people: coming + notComing,
    names: groups.length,
    needsReview: groups.filter((group) => group.needsReview).length,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 10` / `ℹ fail 0`.

- [ ] **Step 5: Adapt the admin component so it compiles**

`app/admin/admin-rsvp.tsx` still references `group.duplicated` and `group.conflicting`. Task 6 restyles this properly; for now make it correct and green.

In the `RsvpGroupRow` function, replace the `const flagged = group.duplicated;` line and the `<div className={...}>` opening with:

```tsx
  const flagged = group.needsReview;

  return (
    <div className={`space-y-2 border p-3 ${flagged ? "border-amber-500/60" : ""}`}>
```

Then replace the badge block — the `{group.conflicting ? ... : flagged ? ... : null}` expression — with:

```tsx
          {flagged ? (
            <Badge variant="outline">
              <AlertTriangle />
              Ответы с {group.submitters.length} устройств
            </Badge>
          ) : group.answerChanges > 0 ? (
            <span className="text-xs text-muted-foreground">
              менял(а) ответ {group.answerChanges}{" "}
              {pluralizeRu(group.answerChanges, ["раз", "раза", "раз"])}
            </span>
          ) : null}
```

In the summary `CardDescription`, replace `{summary.people}` with `{summary.names}` in the "имён" phrase, and replace the trailing flagged clause with:

```tsx
            {summary.needsReview
              ? ` · ${summary.needsReview} ${pluralizeRu(summary.needsReview, [
                  "имя",
                  "имени",
                  "имён",
                ])} с ответами с разных устройств — проверьте вручную`
              : ""}
```

Finally, in `RsvpGroupRow`, the expanded record list should render when `flagged || group.answerChanges > 0` — change the `{flagged ? (` guard around the `<Separator />` block to `{flagged || group.answerChanges > 0 ? (`.

- [ ] **Step 6: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass, zero errors.

- [ ] **Step 7: Verify against real data**

With `DISCORD_WEBHOOK_URL= npm run dev` running, open `/admin`, unlock, and look at the RSVP section.
Expected: names whose records all predate Task 2 (no `submitterId`) show as a single unflagged person; a name you answer twice from the same browser shows «менял(а) ответ N раз» with no amber border; the headcount counts people, not names.

- [ ] **Step 8: Commit**

```bash
git add app/rsvp-data.ts app/admin/admin-rsvp.tsx tests/rsvp-data.test.ts
git commit -m "Group RSVP answers by browser so one guest can't look like two"
```

---

### Task 4: Resolution model, store, and route

Adds the append-only decision record and the endpoint that writes it. Nothing reads resolutions yet — that's Task 5.

**Files:**
- Modify: `app/rsvp-data.ts` (types, `normalizeRsvps`, `parseRsvpResolution`, `submitRsvpResolution`)
- Modify: `app/api/rsvp/store.ts` (`appendResolution`, preserve resolutions in `appendRsvp`)
- Create: `app/api/rsvp/resolve/route.ts`
- Modify: `tests/rsvp-data.test.ts`

**Interfaces:**
- Consumes: `RsvpDocument` from Task 2.
- Produces:
  - `type RsvpResolutionKind = "single" | "split"`
  - `type RsvpResolution = { id, nameKey, kind, attending, coming, notComing, note, recordCount, createdAt }` — every field always present.
  - `RsvpDocument.resolutions: RsvpResolution[]` (always an array after normalization).
  - `parseRsvpResolution(payload: unknown): { ok: true; value: RsvpResolutionInput } | { ok: false; error: string }`
  - `submitRsvpResolution(input): Promise<{ ok: boolean; error?: string; resolution?: RsvpResolution }>` (client-only)
  - `appendResolution(resolution): Promise<RsvpDocument>` (server-only)

- [ ] **Step 1: Write the failing tests**

Append to `tests/rsvp-data.test.ts`:

```ts
import { parseRsvpResolution } from "../app/rsvp-data.ts";

test("normalizes a document with no resolutions to an empty array", () => {
  const document = normalizeRsvps({ records: [] });
  assert.deepEqual(document.resolutions, []);
});

test("accepts a single-person resolution", () => {
  const result = parseRsvpResolution({
    nameKey: "салима е.",
    kind: "single",
    attending: true,
    note: "  это одна и та же  ",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    nameKey: "салима е.",
    kind: "single",
    attending: true,
    coming: 0,
    notComing: 0,
    note: "это одна и та же",
  });
});

test("accepts a split resolution", () => {
  const result = parseRsvpResolution({
    nameKey: "салима е.",
    kind: "split",
    coming: 2,
    notComing: 1,
    note: "",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    nameKey: "салима е.",
    kind: "split",
    attending: false,
    coming: 2,
    notComing: 1,
    note: "",
  });
});

test("rejects a split of fewer than two people", () => {
  const result = parseRsvpResolution({
    nameKey: "салима е.",
    kind: "split",
    coming: 1,
    notComing: 0,
  });

  assert.equal(result.ok, false);
});

test("rejects a missing name, an unknown kind, and a fractional count", () => {
  assert.equal(parseRsvpResolution({ kind: "single", attending: true }).ok, false);
  assert.equal(parseRsvpResolution({ nameKey: "a b", kind: "merge" }).ok, false);
  assert.equal(
    parseRsvpResolution({ nameKey: "a b", kind: "split", coming: 1.5, notComing: 1 }).ok,
    false
  );
});

test("rejects an over-long note", () => {
  const result = parseRsvpResolution({
    nameKey: "a b",
    kind: "single",
    attending: true,
    note: "я".repeat(201),
  });

  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parseRsvpResolution` is not exported, and `document.resolutions` is `undefined`.

- [ ] **Step 3: Add the resolution types and parser**

In `app/rsvp-data.ts`, add below the `RsvpRecord` type:

```ts
export type RsvpResolutionKind = "single" | "split";

/**
 * The couple's decision about one ambiguous name. Append-only like records:
 * changing your mind appends another one and the newest wins.
 */
export type RsvpResolution = {
  id: string;
  /** rsvpNameKey() of the name this applies to. */
  nameKey: string;
  kind: RsvpResolutionKind;
  /** kind "single": the answer that counts. Always false when "split". */
  attending: boolean;
  /** kind "split": how many of these people are coming. 0 when "single". */
  coming: number;
  /** kind "split": how many are not. 0 when "single". */
  notComing: number;
  note: string;
  /** Records in the group when this was decided — the merge base for staleness. */
  recordCount: number;
  createdAt: string;
};

export type RsvpResolutionInput = {
  nameKey: string;
  kind: RsvpResolutionKind;
  attending: boolean;
  coming: number;
  notComing: number;
  note: string;
};

export const RESOLUTION_NOTE_MAX = 200;
```

Update `RsvpDocument`:

```ts
export type RsvpDocument = {
  records: RsvpRecord[];
  resolutions: RsvpResolution[];
  updatedAt?: string;
};
```

Add the parser next to `validateRsvpName`:

```ts
export type RsvpResolutionParse =
  | { ok: true; value: RsvpResolutionInput }
  | { ok: false; error: string };

/** Shared by the admin form and the route handler, so both agree on the rules. */
export function parseRsvpResolution(payload: unknown): RsvpResolutionParse {
  const body = (payload ?? {}) as Record<string, unknown>;
  const nameKey = typeof body.nameKey === "string" ? body.nameKey.trim() : "";

  if (!nameKey) {
    return { ok: false, error: "Не указано имя." };
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (note.length > RESOLUTION_NOTE_MAX) {
    return {
      ok: false,
      error: `Заметка длиннее ${RESOLUTION_NOTE_MAX} символов.`,
    };
  }

  if (body.kind === "single") {
    if (typeof body.attending !== "boolean") {
      return { ok: false, error: "Не выбран ответ." };
    }

    return {
      ok: true,
      value: {
        nameKey,
        kind: "single",
        attending: body.attending,
        coming: 0,
        notComing: 0,
        note,
      },
    };
  }

  if (body.kind === "split") {
    const coming = toPersonCount(body.coming);
    const notComing = toPersonCount(body.notComing);

    if (coming === null || notComing === null) {
      return { ok: false, error: "Количество людей — целое число от нуля." };
    }

    if (coming + notComing < 2) {
      return { ok: false, error: "Разных людей должно быть хотя бы двое." };
    }

    return {
      ok: true,
      value: {
        nameKey,
        kind: "split",
        attending: false,
        coming,
        notComing,
        note,
      },
    };
  }

  return { ok: false, error: "Неизвестный тип решения." };
}

function toPersonCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
```

- [ ] **Step 4: Normalize resolutions**

In `app/rsvp-data.ts`, `normalizeRsvps` must return `resolutions` in all three branches. Replace the function with:

```ts
export function normalizeRsvps(data: unknown): RsvpDocument {
  if (Array.isArray(data)) {
    return {
      records: data.map(normalizeRecord).filter(Boolean) as RsvpRecord[],
      resolutions: [],
    };
  }

  if (data && typeof data === "object" && "records" in data) {
    const record = data as Record<string, unknown>;
    const maybeRecords = record.records;
    const maybeResolutions = record.resolutions;

    return {
      records: Array.isArray(maybeRecords)
        ? (maybeRecords.map(normalizeRecord).filter(Boolean) as RsvpRecord[])
        : [],
      resolutions: Array.isArray(maybeResolutions)
        ? (maybeResolutions
            .map(normalizeResolution)
            .filter(Boolean) as RsvpResolution[])
        : [],
      updatedAt:
        typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
  }

  return { records: [], resolutions: [] };
}

/** A malformed resolution is dropped, which reopens its group. No answer is lost. */
function normalizeResolution(entry: unknown): RsvpResolution | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const parsed = parseRsvpResolution(record);

  if (!parsed.ok) {
    return null;
  }

  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : crypto.randomUUID(),
    ...parsed.value,
    recordCount:
      typeof record.recordCount === "number" &&
      Number.isInteger(record.recordCount) &&
      record.recordCount >= 0
        ? record.recordCount
        : 0,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 16` / `ℹ fail 0`.

- [ ] **Step 6: Add the client helper**

In `app/rsvp-data.ts`, add after `submitRsvp`:

```ts
export type SubmitResolutionResult = {
  ok: boolean;
  error?: string;
  resolution?: RsvpResolution;
};

export async function submitRsvpResolution(
  input: RsvpResolutionInput
): Promise<SubmitResolutionResult> {
  try {
    const response = await fetch("/api/rsvp/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const data = (await response.json().catch(() => null)) as
      | SubmitResolutionResult
      | null;

    if (!response.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${response.status}` };
    }

    return data ?? { ok: false, error: "Пустой ответ сервера." };
  } catch {
    return { ok: false, error: "Не удалось связаться с сервером." };
  }
}
```

- [ ] **Step 7: Append resolutions in the store**

In `app/api/rsvp/store.ts`, `appendRsvp` currently rebuilds the document from `records` alone, which would silently drop every resolution on the next submission. Replace both the fallback in `readRsvpDocument` and `appendRsvp`, and add `appendResolution`:

```ts
export async function readRsvpDocument(): Promise<RsvpDocument> {
  const raw = await readRsvpsRaw();

  if (raw === null) {
    return { records: [], resolutions: [] };
  }

  try {
    return normalizeRsvps(JSON.parse(raw));
  } catch {
    // A corrupted object would otherwise 500 every read; an empty log is recoverable
    // from the Discord backups.
    return { records: [], resolutions: [] };
  }
}

async function writeRsvpDocument(next: RsvpDocument) {
  const { env } = await getCloudflareContext({ async: true });

  await env.WISHLIST_BUCKET.put(RSVP_KEY, JSON.stringify(next), {
    httpMetadata: { contentType: "application/json" },
  });

  return next;
}

/**
 * Appends one record. Existing records and resolutions are never rewritten —
 * this and appendResolution are the only mutations the log supports.
 */
export async function appendRsvp(record: RsvpRecord): Promise<RsvpDocument> {
  const current = await readRsvpDocument();

  return writeRsvpDocument({
    records: [...current.records, record],
    resolutions: current.resolutions,
    updatedAt: new Date().toISOString(),
  });
}

export async function appendResolution(
  resolution: RsvpResolution
): Promise<RsvpDocument> {
  const current = await readRsvpDocument();

  return writeRsvpDocument({
    records: current.records,
    resolutions: [...current.resolutions, resolution],
    updatedAt: new Date().toISOString(),
  });
}
```

Update the import at the top of the file to include the new type:

```ts
import {
  normalizeRsvps,
  type RsvpDocument,
  type RsvpRecord,
  type RsvpResolution,
} from "@/app/rsvp-data";
```

- [ ] **Step 8: Add the route**

Create `app/api/rsvp/resolve/route.ts`:

```ts
import {
  parseRsvpResolution,
  rsvpNameKey,
  type RsvpResolution,
} from "@/app/rsvp-data";
import { appendResolution, readRsvpDocument } from "../store";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Некорректный JSON." },
      { status: 400 }
    );
  }

  const parsed = parseRsvpResolution(payload);

  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  // recordCount is the merge base for staleness, so it must be counted from
  // storage at write time rather than trusted from the client.
  const document = await readRsvpDocument();
  const nameKey = rsvpNameKey(parsed.value.nameKey);
  const recordCount = document.records.filter(
    (record) => rsvpNameKey(record.name) === nameKey
  ).length;

  if (recordCount === 0) {
    return Response.json(
      { ok: false, error: "Нет ответов с таким именем." },
      { status: 404 }
    );
  }

  const resolution: RsvpResolution = {
    id: crypto.randomUUID(),
    ...parsed.value,
    nameKey,
    recordCount,
    createdAt: new Date().toISOString(),
  };

  await appendResolution(resolution);

  return Response.json({ ok: true, resolution });
}
```

- [ ] **Step 9: Verify the route end to end**

With `DISCORD_WEBHOOK_URL= npm run dev` running, first create two records under one name from two "devices":

```bash
curl -s -X POST http://localhost:3000/api/rsvp -H "Content-Type: application/json" -d '{"name":"Resolve T.","attending":true,"submitterId":"device-1"}'
```

```bash
curl -s -X POST http://localhost:3000/api/rsvp -H "Content-Type: application/json" -d '{"name":"Resolve T.","attending":false,"submitterId":"device-2"}'
```

Then resolve:

```bash
curl -s -X POST http://localhost:3000/api/rsvp/resolve -H "Content-Type: application/json" -d '{"nameKey":"resolve t.","kind":"split","coming":1,"notComing":1,"note":"два разных"}'
```

Expected: `{"ok":true,"resolution":{...,"recordCount":2,...}}`

```bash
curl -s -X POST http://localhost:3000/api/rsvp/resolve -H "Content-Type: application/json" -d '{"nameKey":"resolve t.","kind":"split","coming":1,"notComing":0}'
```

Expected: `{"ok":false,"error":"Разных людей должно быть хотя бы двое."}` with status 400.

```bash
curl -s -X POST http://localhost:3000/api/rsvp/resolve -H "Content-Type: application/json" -d '{"nameKey":"nobody z.","kind":"single","attending":true}'
```

Expected: `{"ok":false,"error":"Нет ответов с таким именем."}` with status 404.

Finally confirm both records and the resolution survive a new submission:

```bash
curl -s -X POST http://localhost:3000/api/rsvp -H "Content-Type: application/json" -d '{"name":"Resolve T.","attending":true,"submitterId":"device-3"}' && curl -s http://localhost:3000/api/rsvp
```

Expected: the document still contains the resolution — this is the `appendRsvp` bug from Step 7 staying fixed.

- [ ] **Step 10: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass; the route list now includes `/api/rsvp/resolve`.

- [ ] **Step 11: Commit**

```bash
git add app/rsvp-data.ts app/api/rsvp/store.ts app/api/rsvp/resolve/route.ts tests/rsvp-data.test.ts
git commit -m "Add append-only RSVP resolutions and the endpoint that writes them"
```

---

### Task 5: Apply resolutions to the headcount

Wires resolutions into grouping so a decision drives the count and goes stale when new answers arrive.

**Files:**
- Modify: `app/rsvp-data.ts` (`groupRsvpsByName` signature, `RsvpNameGroup`, `countGroupPeople`, `summarizeRsvps`)
- Modify: `app/admin/admin-rsvp.tsx` (pass resolutions through)
- Modify: `tests/rsvp-data.test.ts`

**Interfaces:**
- Consumes: `RsvpResolution` from Task 4, grouping from Task 3.
- Produces:
  - `groupRsvpsByName(records, resolutions?)` — second parameter optional, defaults to `[]`.
  - `RsvpNameGroup` gains `resolution: RsvpResolution | null` and `resolutionStale: boolean`.
  - `summarizeRsvps` gains `stale: number`; its `needsReview` now counts only *unresolved* groups.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rsvp-data.test.ts`:

```ts
import type { RsvpResolution } from "../app/rsvp-data.ts";

function resolution(overrides: Partial<RsvpResolution>): RsvpResolution {
  return {
    id: "r1",
    nameKey: "алия к.",
    kind: "single",
    attending: true,
    coming: 0,
    notComing: 0,
    note: "",
    recordCount: 2,
    createdAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}

const twoDevices = [
  record("Алия К.", true, "2026-08-10T10:00:00.000Z", "device-1"),
  record("Алия К.", false, "2026-08-10T10:01:00.000Z", "device-2"),
];

test("a single resolution overrides the automatic count", () => {
  const [group] = groupRsvpsByName(twoDevices, [
    resolution({ kind: "single", attending: true }),
  ]);

  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 0 });
  assert.equal(group.resolutionStale, false);
});

test("a split resolution counts everyone it names", () => {
  const [group] = groupRsvpsByName(twoDevices, [
    resolution({ kind: "split", attending: false, coming: 2, notComing: 1 }),
  ]);

  assert.deepEqual(countGroupPeople(group), { coming: 2, notComing: 1 });
});

test("the newest resolution for a name wins", () => {
  const [group] = groupRsvpsByName(twoDevices, [
    resolution({ id: "old", attending: true, createdAt: "2026-08-10T12:00:00.000Z" }),
    resolution({ id: "new", attending: false, createdAt: "2026-08-10T13:00:00.000Z" }),
  ]);

  assert.equal(group.resolution?.id, "new");
  assert.deepEqual(countGroupPeople(group), { coming: 0, notComing: 1 });
});

test("a resolution goes stale when new answers arrive, but still counts", () => {
  const [group] = groupRsvpsByName(
    [
      ...twoDevices,
      record("Алия К.", true, "2026-08-10T14:00:00.000Z", "device-3"),
    ],
    [resolution({ kind: "single", attending: true, recordCount: 2 })]
  );

  assert.equal(group.resolutionStale, true);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 0 });
});

test("a resolution for another name is ignored", () => {
  const [group] = groupRsvpsByName(twoDevices, [
    resolution({ nameKey: "кто-то другой" }),
  ]);

  assert.equal(group.resolution, null);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 1 });
});

test("resolved groups drop out of the needs-review count", () => {
  const summary = summarizeRsvps(
    groupRsvpsByName(twoDevices, [resolution({ recordCount: 1 })])
  );

  assert.equal(summary.needsReview, 0);
  assert.equal(summary.stale, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `groupRsvpsByName` takes one argument, and `group.resolution` / `group.resolutionStale` / `summary.stale` are `undefined`.

- [ ] **Step 3: Attach resolutions to groups**

In `app/rsvp-data.ts`, add the two fields to `RsvpNameGroup` after `needsReview`:

```ts
  /** The couple's latest decision about this name, if any. */
  resolution: RsvpResolution | null;
  /** Answers arrived after the decision was made — worth another look. */
  resolutionStale: boolean;
```

Change the signature and body of `groupRsvpsByName` — the parameter list and the object it maps to:

```ts
export function groupRsvpsByName(
  records: RsvpRecord[],
  resolutions: RsvpResolution[] = []
): RsvpNameGroup[] {
  const groups = new Map<string, RsvpRecord[]>();

  for (const record of records) {
    const key = rsvpNameKey(record.name);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const latestResolutions = latestResolutionByName(resolutions);

  return Array.from(groups.entries())
    .map(([key, groupRecords]) => {
      const sorted = sortByCreatedAt(groupRecords);
      const latest = sorted[sorted.length - 1];
      const submitters = groupBySubmitter(sorted);
      const resolution = latestResolutions.get(key) ?? null;

      return {
        key,
        name: latest.name,
        records: sorted,
        submitters,
        latest,
        answerChanges: submitters.reduce(
          (total, submitter) => total + countAnswerFlips(submitter.records),
          0
        ),
        needsReview: submitters.length > 1,
        resolution,
        resolutionStale: resolution
          ? sorted.length > resolution.recordCount
          : false,
      };
    })
    .sort(
      (first, second) =>
        toTime(second.latest.createdAt) - toTime(first.latest.createdAt)
    );
}

function latestResolutionByName(resolutions: RsvpResolution[]) {
  const latest = new Map<string, RsvpResolution>();

  for (const resolution of resolutions) {
    const key = rsvpNameKey(resolution.nameKey);
    const current = latest.get(key);

    if (!current || toTime(resolution.createdAt) >= toTime(current.createdAt)) {
      latest.set(key, resolution);
    }
  }

  return latest;
}
```

- [ ] **Step 4: Let a resolution decide the count**

Replace `countGroupPeople` and `summarizeRsvps` with:

```ts
/**
 * How many people this name contributes to the headcount. A resolution decides
 * outright; otherwise each browser counts as one person with its latest answer.
 */
export function countGroupPeople(group: RsvpNameGroup) {
  const { resolution } = group;

  if (resolution) {
    if (resolution.kind === "single") {
      return resolution.attending
        ? { coming: 1, notComing: 0 }
        : { coming: 0, notComing: 1 };
    }

    return { coming: resolution.coming, notComing: resolution.notComing };
  }

  let coming = 0;
  let notComing = 0;

  for (const submitter of group.submitters) {
    if (submitter.latest.attending) {
      coming += 1;
    } else {
      notComing += 1;
    }
  }

  return { coming, notComing };
}

export function summarizeRsvps(groups: RsvpNameGroup[]) {
  let coming = 0;
  let notComing = 0;

  for (const group of groups) {
    const counts = countGroupPeople(group);
    coming += counts.coming;
    notComing += counts.notComing;
  }

  return {
    coming,
    notComing,
    people: coming + notComing,
    names: groups.length,
    needsReview: groups.filter(
      (group) => group.needsReview && !group.resolution
    ).length,
    stale: groups.filter((group) => group.resolutionStale).length,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 22` / `ℹ fail 0`.

- [ ] **Step 6: Pass resolutions through the admin component**

In `app/admin/admin-rsvp.tsx`, hold the resolutions in state alongside the records. Replace the `records` state declaration and the `groups` memo with:

```tsx
  const [records, setRecords] = useState<RsvpRecord[]>([]);
  const [resolutions, setResolutions] = useState<RsvpResolution[]>([]);
```

```tsx
  const groups = useMemo(
    () => groupRsvpsByName(records, resolutions),
    [records, resolutions]
  );
```

In `loadRsvps`, store both:

```tsx
      const document = await fetchRsvps();
      setRecords(document.records);
      setResolutions(document.resolutions);
```

Add `RsvpResolution` to the type imports from `"../rsvp-data"`.

- [ ] **Step 7: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 8: Verify against real data**

With the dev server running and the "Resolve T." fixture from Task 4 in local R2, open `/admin`.
Expected: the resolved name's contribution to the headcount matches the resolution (1/1 from the split), not the automatic count.

- [ ] **Step 9: Commit**

```bash
git add app/rsvp-data.ts app/admin/admin-rsvp.tsx tests/rsvp-data.test.ts
git commit -m "Let an RSVP resolution decide the headcount for its name"
```

---

### Task 6: Admin resolve controls

The visible half: four row states and the inline controls that write a resolution.

**Files:**
- Modify: `app/admin/admin-rsvp.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–5, plus `submitRsvpResolution` from Task 4.
- Produces: no new exports.

- [ ] **Step 1: Add resolve state and the save handler**

In `AdminRsvp`, add below the existing state declarations:

```tsx
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState("");
```

And add this handler next to `handleBackup`:

```tsx
  /** Resolves to false on failure so the row can keep its controls open. */
  async function handleResolve(input: RsvpResolutionInput) {
    setResolvingKey(input.nameKey);
    setResolveError("");

    const result = await submitRsvpResolution(input);

    if (!result.ok || !result.resolution) {
      setResolveError(result.error ?? "Не удалось сохранить решение.");
      setResolvingKey(null);
      return false;
    }

    const saved = result.resolution;
    setResolutions((current) => [...current, saved]);
    setResolvingKey(null);
    void triggerRsvpBackup();

    return true;
  }
```

Add `submitRsvpResolution` and `type RsvpResolutionInput` to the imports from `"../rsvp-data"`.

- [ ] **Step 2: Pass it down**

Where `<RsvpGroupRow key={group.key} group={group} />` is rendered, replace with:

```tsx
              <RsvpGroupRow
                key={group.key}
                group={group}
                busy={resolvingKey === group.key}
                error={resolvingKey === group.key ? resolveError : ""}
                onResolve={handleResolve}
              />
```

- [ ] **Step 3: Replace the row component**

Replace the entire `RsvpGroupRow` function with:

```tsx
function RsvpGroupRow({
  group,
  busy,
  error,
  onResolve,
}: {
  group: RsvpNameGroup;
  busy: boolean;
  error: string;
  onResolve: (input: RsvpResolutionInput) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"none" | "single" | "split">("none");
  const [note, setNote] = useState("");
  const [attending, setAttending] = useState(group.latest.attending);
  const [coming, setComing] = useState(
    () => countGroupPeople({ ...group, resolution: null }).coming
  );
  const [notComing, setNotComing] = useState(
    () => countGroupPeople({ ...group, resolution: null }).notComing
  );

  const counts = countGroupPeople(group);
  const unresolved = group.needsReview && !group.resolution;
  const showHistory = group.needsReview || group.answerChanges > 0;
  const border = group.resolutionStale
    ? "border-amber-500/60"
    : unresolved
      ? "border-destructive/60 bg-destructive/5"
      : "";

  // Only closes on success — a failed write keeps the entered values on screen.
  async function save(kind: "single" | "split") {
    const saved = await onResolve({
      nameKey: group.key,
      kind,
      attending: kind === "single" ? attending : false,
      coming: kind === "split" ? coming : 0,
      notComing: kind === "split" ? notComing : 0,
      note,
    });

    if (saved) {
      setMode("none");
    }
  }

  return (
    <div className={`space-y-2 border p-3 ${border}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{group.name}</span>
          <Badge variant={counts.coming ? "default" : "secondary"}>
            {counts.coming} придут / {counts.notComing} нет
          </Badge>
          {unresolved ? (
            <Badge variant="destructive">
              <AlertTriangle />
              Ответы с {group.submitters.length} устройств
            </Badge>
          ) : null}
          {group.resolutionStale ? (
            <Badge variant="outline">
              <AlertTriangle />
              После решения пришли новые ответы
            </Badge>
          ) : null}
          {group.answerChanges > 0 && !group.needsReview ? (
            <span className="text-xs text-muted-foreground">
              менял(а) ответ {group.answerChanges}{" "}
              {pluralizeRu(group.answerChanges, ["раз", "раза", "раз"])}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRsvpTimestamp(group.latest.createdAt)}
        </span>
      </div>

      {group.resolution ? (
        <p className="text-xs text-muted-foreground">
          Решено:{" "}
          {group.resolution.kind === "single"
            ? `один человек, ${group.resolution.attending ? "придёт" : "не придёт"}`
            : `${group.resolution.coming} придут, ${group.resolution.notComing} нет`}
          {group.resolution.note ? ` — ${group.resolution.note}` : ""}
        </p>
      ) : null}

      {showHistory ? (
        <>
          <Separator />
          {group.submitters.map((submitter, index) => (
            <div key={submitter.submitterId || "legacy"} className="space-y-1">
              <p className="text-xs font-medium">
                {submitter.submitterId
                  ? `Устройство ${index + 1}`
                  : "Старые ответы (без устройства)"}
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {submitter.records.map((record) => (
                  <li key={record.id} className="flex justify-between gap-3">
                    <span>{record.attending ? "придёт" : "не придёт"}</span>
                    <span>{formatRsvpTimestamp(record.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : null}

      {group.needsReview ? (
        <>
          {mode === "none" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setMode("single")}
              >
                Это один человек
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setMode("split")}
              >
                Разные люди
              </Button>
            </div>
          ) : null}

          {mode === "single" ? (
            <div className="space-y-2 border p-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={attending ? "default" : "outline"}
                  onClick={() => setAttending(true)}
                >
                  Придёт
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={attending ? "outline" : "default"}
                  onClick={() => setAttending(false)}
                >
                  Не придёт
                </Button>
              </div>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Заметка (необязательно)"
                maxLength={RESOLUTION_NOTE_MAX}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save("single")}
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Сохранить
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("none")}
                >
                  Отмена
                </Button>
              </div>
            </div>
          ) : null}

          {mode === "split" ? (
            <div className="space-y-2 border p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Label htmlFor={`coming-${group.key}`}>Придут</Label>
                <Input
                  id={`coming-${group.key}`}
                  type="number"
                  min={0}
                  className="w-20"
                  value={coming}
                  onChange={(event) =>
                    setComing(Math.max(0, Number(event.target.value) || 0))
                  }
                />
                <Label htmlFor={`not-coming-${group.key}`}>Не придут</Label>
                <Input
                  id={`not-coming-${group.key}`}
                  type="number"
                  min={0}
                  className="w-20"
                  value={notComing}
                  onChange={(event) =>
                    setNotComing(Math.max(0, Number(event.target.value) || 0))
                  }
                />
              </div>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Кто есть кто (необязательно)"
                maxLength={RESOLUTION_NOTE_MAX}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || coming + notComing < 2}
                  onClick={() => void save("split")}
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Сохранить
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("none")}
                >
                  Отмена
                </Button>
              </div>
              {coming + notComing < 2 ? (
                <p className="text-xs text-muted-foreground">
                  Разных людей должно быть хотя бы двое.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
```

Add the imports this needs at the top of the file: `Input` from `@/components/ui/input`, `Label` from `@/components/ui/label`, and `countGroupPeople`, `RESOLUTION_NOTE_MAX`, `submitRsvpResolution`, `type RsvpResolutionInput` from `"../rsvp-data"`. `useState` is already imported.

- [ ] **Step 4: Update the summary line**

Replace the `CardTitle`/`CardDescription` pair with:

```tsx
          <CardTitle>
            {summary.coming} придут / {summary.notComing} не придут
          </CardTitle>
          <CardDescription>
            {summary.names}{" "}
            {pluralizeRu(summary.names, ["имя", "имени", "имён"])},{" "}
            {records.length}{" "}
            {pluralizeRu(records.length, ["ответ", "ответа", "ответов"])} всего
            {summary.needsReview
              ? ` · ${summary.needsReview} нужно разобрать`
              : ""}
            {summary.stale ? ` · ${summary.stale} с новыми ответами` : ""}
          </CardDescription>
```

- [ ] **Step 5: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Walk the four states in the browser**

With `DISCORD_WEBHOOK_URL= npm run dev` running, on `/admin`:

1. A name answered once → clean row, no controls.
2. Same browser, opposite answer → «менял(а) ответ 1 раз», no colour, no controls.
3. A second browser profile (or a `curl` POST with a different `submitterId`) under that name → red border, device buckets, both buttons.
4. «Это один человек» → pick an answer, save → the row shows «Решено: один человек, …», headcount drops by one, red border gone.
5. `curl` another record for that name → amber «После решения пришли новые ответы», headcount unchanged.
6. Reload the page → every state above survives, because all of it is derived from the stored document.

- [ ] **Step 7: Commit**

```bash
git add app/admin/admin-rsvp.tsx
git commit -m "Add inline resolve controls to the admin RSVP section"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/rsvp.md`
- Modify: `docs/gotchas.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: nothing code-facing.

- [ ] **Step 1: Document the model in `docs/rsvp.md`**

Add after the "Append-only storage" section:

```markdown
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
```

- [ ] **Step 2: Record the legacy trade-off in `docs/gotchas.md`**

Append:

```markdown
## Records written before `submitterId` all share one bucket

`RsvpRecord.submitterId` was added after the RSVP feature shipped, so earlier records normalize to
`""`. Grouping treats every `""` record for a name as **one** browser, not as N unknown ones.

That's deliberate: the alternative flags every historical name as ambiguous, and the duplicates
actually in the log were one person pressing the button repeatedly. The cost is that if two real
guests both answered before the id existed, they count as one person until one of them answers again
from a browser that has an id. If a headcount ever looks one short for an old name, this is why —
it isn't a grouping bug.
```

- [ ] **Step 3: Extend the append-only note in `AGENTS.md`**

In the RSVP paragraph of the "Storage model" section, after the sentence ending "uses the latest per name.", add:

```markdown
The same rule covers resolutions: the couple's decisions about ambiguous names live in
`document.resolutions`, are appended by `appendResolution()`, and are never edited — re-deciding
appends another and the newest wins. Any new write path must preserve *both* arrays; `appendRsvp()`
once rebuilt the document from `records` alone, which would have silently dropped every resolution.
```

- [ ] **Step 4: Verify the links resolve**

Run: `npm run lint`
Expected: passes. Then re-read `docs/rsvp.md` top to bottom and confirm it describes the code as built — particularly that the flag rules in the doc match `needsReview` in `app/rsvp-data.ts`.

- [ ] **Step 5: Commit**

```bash
git add docs/rsvp.md docs/gotchas.md AGENTS.md
git commit -m "Document RSVP submitter identity and the resolution model"
```

---

## Verification checklist

Before calling the feature done, from a clean checkout:

- [ ] `npm test` — all tests pass
- [ ] `npx tsc --noEmit` — silent
- [ ] `npm run lint` — zero errors (3 pre-existing warnings are expected)
- [ ] `npm run build` — succeeds, route list includes `/api/rsvp/resolve`
- [ ] The seven-record Салима Е. group in production data renders as one unflagged person
- [ ] A resolution survives a subsequent RSVP submission (the `appendRsvp` regression from Task 4)
