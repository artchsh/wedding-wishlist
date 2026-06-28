import { getCloudflareContext } from "@opennextjs/cloudflare";

const WISHLIST_KEY = "wishlist.json";
const CACHE_KEY = new Request(
  "https://wedding-wishlist-internal.cache/wishlist.json"
);

function getEdgeCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  return (caches as unknown as { default: Cache }).default;
}

export async function GET() {
  const cache = getEdgeCache();
  const cached = await cache?.match(CACHE_KEY);
  if (cached) return cached;

  const { env, ctx } = await getCloudflareContext({ async: true });

  const object = await env.WISHLIST_BUCKET.get(WISHLIST_KEY);

  if (!object) {
    return Response.json(
      { ok: false, error: "Список подарков ещё не создан." },
      { status: 404 }
    );
  }

  const body = await object.text();
  const response = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10",
    },
  });

  if (cache) {
    ctx.waitUntil(cache.put(CACHE_KEY, response.clone()));
  }

  return response;
}

export async function POST(request: Request) {
  const { env, ctx } = await getCloudflareContext({ async: true });

  const body = await request.text();

  try {
    JSON.parse(body);
  } catch {
    return Response.json(
      { ok: false, error: "Некорректный JSON." },
      { status: 400 }
    );
  }

  await env.WISHLIST_BUCKET.put(WISHLIST_KEY, body, {
    httpMetadata: { contentType: "application/json" },
  });

  const cache = getEdgeCache();
  if (cache) {
    ctx.waitUntil(cache.delete(CACHE_KEY));
  }

  return Response.json({ ok: true });
}
