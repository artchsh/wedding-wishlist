type KaspiOffer = {
  "@type"?: string;
  price?: string | number;
  priceCurrency?: string;
};

type KaspiProduct = {
  "@type"?: string;
  name?: string;
  image?: string | string[];
  category?: string;
  offers?: KaspiOffer | KaspiOffer[];
};

export async function POST(request: Request) {
  const { url } = (await request.json().catch(() => ({}))) as {
    url?: string;
  };

  if (!url) {
    return Response.json(
      { ok: false, error: "Ссылка не указана." },
      { status: 400 }
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return Response.json(
      { ok: false, error: "Некорректная ссылка." },
      { status: 400 }
    );
  }

  if (
    parsedUrl.hostname !== "kaspi.kz" &&
    !parsedUrl.hostname.endsWith(".kaspi.kz")
  ) {
    return Response.json(
      { ok: false, error: "Поддерживаются только ссылки на kaspi.kz." },
      { status: 400 }
    );
  }

  let html: string;
  try {
    const pageResponse = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!pageResponse.ok) {
      return Response.json(
        {
          ok: false,
          error: `Kaspi.kz ответил ${pageResponse.status}. Возможно, товар недоступен.`,
        },
        { status: 502 }
      );
    }

    html = await pageResponse.text();
  } catch {
    return Response.json(
      { ok: false, error: "Не удалось загрузить страницу Kaspi.kz." },
      { status: 502 }
    );
  }

  const product = extractProduct(html);

  if (!product) {
    return Response.json(
      {
        ok: false,
        error: "Не удалось найти данные о товаре на странице.",
      },
      { status: 422 }
    );
  }

  const offer = Array.isArray(product.offers)
    ? product.offers.find((item) => item?.price)
    : product.offers;

  const imageUrl = Array.isArray(product.image)
    ? product.image[0] ?? ""
    : product.image ?? "";

  return Response.json({
    ok: true,
    title: typeof product.name === "string" ? product.name : "",
    imageUrl: typeof imageUrl === "string" ? imageUrl : "",
    category: typeof product.category === "string" ? product.category : "",
    price: offer?.price ? String(offer.price) : "",
    priceCurrency: offer?.priceCurrency === "USD" ? "USD" : "KZT",
  });
}

function extractProduct(html: string): KaspiProduct | null {
  const scriptPattern =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

  for (const match of html.matchAll(scriptPattern)) {
    try {
      const data = JSON.parse(match[1].trim()) as KaspiProduct;
      if (data["@type"] === "Product") {
        return data;
      }
    } catch {
      continue;
    }
  }

  return null;
}
