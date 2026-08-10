export type RsvpRecord = {
  id: string;
  name: string;
  attending: boolean;
  /** Anonymous per-browser id. "" for records written before this existed. */
  submitterId: string;
  createdAt: string;
};

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

export type RsvpDocument = {
  records: RsvpRecord[];
  resolutions: RsvpResolution[];
  updatedAt?: string;
};

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

function normalizeRecord(entry: unknown): RsvpRecord | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const name = typeof record.name === "string" ? normalizeRsvpName(record.name) : "";

  if (!name) {
    return null;
  }

  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : crypto.randomUUID(),
    name,
    attending: record.attending === true,
    submitterId:
      typeof record.submitterId === "string" ? record.submitterId : "",
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
}

/** Trims and collapses inner whitespace so "Александр   П." and "Александр П." match. */
export function normalizeRsvpName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Case-insensitive key used to group submissions from the same person. */
export function rsvpNameKey(name: string) {
  return normalizeRsvpName(name).toLocaleLowerCase("ru");
}

export const RSVP_NAME_HINT = "Например: «Александр П.» или «Алия К.»";

/**
 * Light format check: a name, a space, and at least one letter after it.
 * Returns a Russian error message, or null when the name is acceptable.
 */
export function validateRsvpName(value: string): string | null {
  const name = normalizeRsvpName(value);

  if (!name) {
    return "Впишите имя, иначе непонятно, кто это.";
  }

  const spaceIndex = name.indexOf(" ");

  if (spaceIndex === -1) {
    return `Нужен пробел: имя, пробел и первая буква фамилии. ${RSVP_NAME_HINT}`;
  }

  if (!/^\p{L}/u.test(name)) {
    return `Имя должно начинаться с буквы. ${RSVP_NAME_HINT}`;
  }

  if (!/^\p{L}/u.test(name.slice(spaceIndex + 1))) {
    return `После пробела нужна первая буква фамилии. ${RSVP_NAME_HINT}`;
  }

  return null;
}

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

/** Russian plural forms: 1 имя, 2 имени, 5 имён. */
export function pluralizeRu(
  count: number,
  forms: [one: string, few: string, many: string]
) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;

  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];

  return forms[2];
}

function toTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function formatRsvpTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-KZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

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

export async function fetchRsvps(signal?: AbortSignal) {
  const response = await fetch("/api/rsvp", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error("Could not load the RSVP log.");
  }

  return normalizeRsvps(await response.json());
}

export type SubmitRsvpResult = {
  ok: boolean;
  error?: string;
  record?: RsvpRecord;
};

export async function submitRsvp(
  name: string,
  attending: boolean
): Promise<SubmitRsvpResult> {
  try {
    const response = await fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, attending, submitterId: getSubmitterId() }),
    });

    const data = (await response.json().catch(() => null)) as
      | SubmitRsvpResult
      | null;

    if (!response.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${response.status}` };
    }

    return data ?? { ok: false, error: "Пустой ответ сервера." };
  } catch {
    return { ok: false, error: "Не удалось связаться с сервером." };
  }
}

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

export async function triggerRsvpBackup(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const response = await fetch("/api/backup/rsvp", { method: "POST" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, error: data?.error ?? `HTTP ${response.status}` };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось связаться с сервером." };
  }
}
