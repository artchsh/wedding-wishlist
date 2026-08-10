import { readRsvpDocument } from "@/app/api/rsvp/store";
import { sendDiscordBackup } from "../discord";

export async function POST() {
  // Server-side code must read R2 directly — the client helpers in app/rsvp-data.ts
  // use relative URLs and throw here. See docs/gotchas.md.
  const document = await readRsvpDocument();

  if (!document.records.length) {
    return Response.json(
      { ok: false, error: "Ответов пока нет." },
      { status: 404 }
    );
  }

  const timestamp = new Date().toISOString();

  return sendDiscordBackup({
    content: `Бэкап RSVP — ${timestamp} (${document.records.length} ответов)`,
    filename: `rsvp-backup-${Date.now()}.json`,
    json: JSON.stringify(document, null, 2),
  });
}
