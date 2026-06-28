import { getCloudflareContext } from "@opennextjs/cloudflare";

const WISHLIST_KEY = "wishlist.json";

export async function GET() {
  const { env } = await getCloudflareContext({ async: true });

  const object = await env.WISHLIST_BUCKET.get(WISHLIST_KEY);

  if (!object) {
    return Response.json(
      { ok: false, error: "Список подарков ещё не создан." },
      { status: 404 }
    );
  }

  return new Response(object.body, {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });

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

  return Response.json({ ok: true });
}
