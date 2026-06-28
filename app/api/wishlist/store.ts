import { getCloudflareContext } from "@opennextjs/cloudflare";

export const WISHLIST_KEY = "wishlist.json";

export async function readWishlistRaw(): Promise<string | null> {
  const { env } = await getCloudflareContext({ async: true });
  const object = await env.WISHLIST_BUCKET.get(WISHLIST_KEY);

  if (!object) return null;

  return object.text();
}
