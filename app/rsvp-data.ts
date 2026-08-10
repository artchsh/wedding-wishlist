export type RsvpRecord = {
  id: string;
  name: string;
  attending: boolean;
  /** Anonymous per-browser id. "" for records written before this existed. */
  submitterId: string;
  createdAt: string;
};

export type RsvpDocument = {
  records: RsvpRecord[];
  updatedAt?: string;
};

export function normalizeRsvps(data: unknown): RsvpDocument {
  if (Array.isArray(data)) {
    return {
      records: data.map(normalizeRecord).filter(Boolean) as RsvpRecord[],
    };
  }

  if (data && typeof data === "object" && "records" in data) {
    const record = data as Record<string, unknown>;
    const maybeRecords = record.records;

    return {
      records: Array.isArray(maybeRecords)
        ? (maybeRecords.map(normalizeRecord).filter(Boolean) as RsvpRecord[])
        : [],
      updatedAt:
        typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
  }

  return { records: [] };
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

export type RsvpNameGroup = {
  key: string;
  /** Display name taken from the most recent submission for this key. */
  name: string;
  /** Every submission for this name, oldest first. */
  records: RsvpRecord[];
  /** The most recent submission — the one that counts toward the headcount. */
  latest: RsvpRecord;
  /** More than one submission under the same name string. */
  duplicated: boolean;
  /** Submissions under this name disagree about coming vs. not coming. */
  conflicting: boolean;
};

/**
 * Groups the append-only log by name. Two real guests can share one name string,
 * so groups with more than one record are flagged for manual review instead of
 * being merged automatically.
 */
export function groupRsvpsByName(records: RsvpRecord[]): RsvpNameGroup[] {
  const groups = new Map<string, RsvpRecord[]>();

  for (const record of records) {
    const key = rsvpNameKey(record.name);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return Array.from(groups.entries())
    .map(([key, groupRecords]) => {
      const sorted = [...groupRecords].sort(
        (first, second) => toTime(first.createdAt) - toTime(second.createdAt)
      );
      const latest = sorted[sorted.length - 1];

      return {
        key,
        name: latest.name,
        records: sorted,
        latest,
        duplicated: sorted.length > 1,
        conflicting: new Set(sorted.map((record) => record.attending)).size > 1,
      };
    })
    .sort(
      (first, second) =>
        toTime(second.latest.createdAt) - toTime(first.latest.createdAt)
    );
}

export function summarizeRsvps(groups: RsvpNameGroup[]) {
  return {
    coming: groups.filter((group) => group.latest.attending).length,
    notComing: groups.filter((group) => !group.latest.attending).length,
    flagged: groups.filter((group) => group.duplicated).length,
    people: groups.length,
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
