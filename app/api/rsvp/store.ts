import { getCloudflareContext } from "@opennextjs/cloudflare";
import { normalizeRsvps, type RsvpDocument, type RsvpRecord } from "@/app/rsvp-data";

// Lives in the same R2 bucket as wishlist.json, under its own key.
export const RSVP_KEY = "rsvps.json";

export async function readRsvpsRaw(): Promise<string | null> {
  const { env } = await getCloudflareContext({ async: true });
  const object = await env.WISHLIST_BUCKET.get(RSVP_KEY);

  if (!object) return null;

  return object.text();
}

export async function readRsvpDocument(): Promise<RsvpDocument> {
  const raw = await readRsvpsRaw();

  if (raw === null) {
    return { records: [] };
  }

  try {
    return normalizeRsvps(JSON.parse(raw));
  } catch {
    // A corrupted object would otherwise 500 every read; an empty log is recoverable
    // from the Discord backups.
    return { records: [] };
  }
}

/**
 * Appends one record to the log and writes it back. Existing records are never
 * rewritten — this is the only mutation the RSVP log supports.
 */
export async function appendRsvp(record: RsvpRecord): Promise<RsvpDocument> {
  const { env } = await getCloudflareContext({ async: true });
  const current = await readRsvpDocument();

  const next: RsvpDocument = {
    records: [...current.records, record],
    updatedAt: new Date().toISOString(),
  };

  await env.WISHLIST_BUCKET.put(RSVP_KEY, JSON.stringify(next), {
    httpMetadata: { contentType: "application/json" },
  });

  return next;
}
