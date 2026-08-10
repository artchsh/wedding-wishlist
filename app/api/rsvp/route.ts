import { normalizeRsvpName, validateRsvpName, type RsvpRecord } from "@/app/rsvp-data";
import { appendRsvp, readRsvpDocument } from "./store";

// No edge cache here (unlike /api/wishlist): the log is read by the admin page, which
// must never see a stale headcount, and reads are rare enough that caching buys nothing.
export async function GET() {
  const document = await readRsvpDocument();

  return Response.json(document, {
    headers: { "Cache-Control": "no-store" },
  });
}

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

  const body = (payload ?? {}) as Record<string, unknown>;
  const rawName = typeof body.name === "string" ? body.name : "";
  const nameError = validateRsvpName(rawName);

  if (nameError) {
    return Response.json({ ok: false, error: nameError }, { status: 400 });
  }

  if (typeof body.attending !== "boolean") {
    return Response.json(
      { ok: false, error: "Не понятно, придёте вы или нет." },
      { status: 400 }
    );
  }

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

  await appendRsvp(record);

  return Response.json({ ok: true, record });
}
