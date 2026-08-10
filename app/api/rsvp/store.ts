import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  normalizeRsvps,
  type RsvpDocument,
  type RsvpRecord,
  type RsvpResolution,
} from "@/app/rsvp-data";

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
