import {
  clampMergeBase,
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

  const document = await readRsvpDocument();
  const nameKey = rsvpNameKey(parsed.value.nameKey);
  const serverCount = document.records.filter(
    (record) => rsvpNameKey(record.name) === nameKey
  ).length;

  if (serverCount === 0) {
    return Response.json(
      { ok: false, error: "Нет ответов с таким именем." },
      { status: 404 }
    );
  }

  // recordCount is the merge base for staleness: it should reflect what the
  // couple actually had in front of them when they decided, not whatever
  // landed in storage between page load and this request. We take the
  // client's observed count (app/admin/admin-rsvp.tsx sends
  // group.records.length as of its last fetch) and clamp it to serverCount
  // — a client can only make its own resolution *more* stale this way, never
  // less, so a spoofed high value can't suppress the flag. A missing or
  // malformed value falls back to serverCount, today's behavior.
  const recordCount = clampMergeBase(
    (payload as Record<string, unknown> | null)?.observedRecordCount,
    serverCount
  );

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
