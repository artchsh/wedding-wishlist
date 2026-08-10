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
