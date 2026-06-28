export const API_URL = "https://api.npoint.io/8771deb313d9bd0570e7";
export const EXCHANGE_RATE_URL = "https://api.exchangerate.fun/latest?base=USD";

export type PriceCurrency = "KZT" | "USD";
export type DeliveryEstimate = "" | "SHORT" | "LONG";

export type WishlistItem = {
  id: string;
  title: string;
  note: string;
  url: string;
  imageUrl: string;
  category: string;
  price: string;
  priceCurrency: PriceCurrency;
  deliveryEstimate: DeliveryEstimate;
  reservedBy: string;
  createdAt: string;
};

export type WishlistDocument = {
  items: WishlistItem[];
  updatedAt?: string;
};

export const starterItems: WishlistItem[] = [
  {
    id: "starter-neon-kettle",
    title: "Кофейная станция",
    note: "Для уютных завтраков и поздних вечеров дома.",
    url: "",
    imageUrl: "",
    category: "Кухня",
    price: "80 000 ₸",
    priceCurrency: "KZT",
    deliveryEstimate: "SHORT",
    reservedBy: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "starter-chrome-luggage",
    title: "Чемодан для поездок",
    note: "Для медового месяца и коротких путешествий.",
    url: "",
    imageUrl: "",
    category: "Путешествия",
    price: "110 000 ₸",
    priceCurrency: "KZT",
    deliveryEstimate: "LONG",
    reservedBy: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "starter-smart-lights",
    title: "Умное освещение",
    note: "Для первого общего дома.",
    url: "",
    imageUrl: "",
    category: "Дом",
    price: "55 000 ₸",
    priceCurrency: "KZT",
    deliveryEstimate: "SHORT",
    reservedBy: "",
    createdAt: new Date().toISOString(),
  },
];

export function normalizeWishlist(data: unknown): WishlistDocument {
  if (Array.isArray(data)) {
    return { items: data.map(normalizeItem).filter(Boolean) as WishlistItem[] };
  }

  if (data && typeof data === "object" && "items" in data) {
    const record = data as Record<string, unknown>;
    const maybeItems = record.items;

    return {
      items: Array.isArray(maybeItems)
        ? (maybeItems.map(normalizeItem).filter(Boolean) as WishlistItem[])
        : [],
      updatedAt:
        typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
  }

  return { items: [] };
}

function normalizeItem(item: unknown): WishlistItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";

  if (!title) {
    return null;
  }

  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : crypto.randomUUID(),
    title,
    note: typeof record.note === "string" ? record.note : "",
    url: typeof record.url === "string" ? record.url : "",
    imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : "",
    category: typeof record.category === "string" ? record.category : "",
    price: typeof record.price === "string" ? record.price : "",
    priceCurrency: normalizeCurrency(record.priceCurrency, record.price),
    deliveryEstimate: normalizeDeliveryEstimate(record.deliveryEstimate),
    reservedBy:
      typeof record.reservedBy === "string" ? record.reservedBy : "",
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
}

function normalizeDeliveryEstimate(value: unknown): DeliveryEstimate {
  return value === "SHORT" || value === "LONG" ? value : "";
}

export function formatDeliveryEstimate(value: DeliveryEstimate) {
  if (value === "SHORT") {
    return "SHORT DELIVERY (1-2 WEEKS)";
  }

  if (value === "LONG") {
    return "LONG DELIVERY (2+ WEEKS)";
  }

  return "";
}

function normalizeCurrency(
  currency: unknown,
  price: unknown
): PriceCurrency {
  if (currency === "USD" || currency === "KZT") {
    return currency;
  }

  return typeof price === "string" && price.includes("$") ? "USD" : "KZT";
}

export async function fetchWishlist(signal?: AbortSignal) {
  const response = await fetch(API_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error("Could not load the wishlist.");
  }

  return normalizeWishlist(await response.json());
}

export function parsePrice(value: string) {
  const normalized = value.replace(/[^\d]/g, "");
  const parsed = Number.parseInt(normalized, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

export function getPriceInKzt(
  item: Pick<WishlistItem, "price" | "priceCurrency">,
  usdToKztRate: number | null
) {
  const parsed = parsePrice(item.price);

  if (parsed === null) {
    return null;
  }

  if (item.priceCurrency === "USD") {
    return usdToKztRate ? Math.round(parsed * usdToKztRate) : null;
  }

  return parsed;
}

export function formatKztPrice(value: number | string) {
  const parsed = typeof value === "number" ? value : parsePrice(value);

  if (parsed === null) {
    return String(value);
  }

  return `${new Intl.NumberFormat("ru-KZ").format(parsed)} ₸`;
}

export function formatOriginalPrice(
  item: Pick<WishlistItem, "price" | "priceCurrency">
) {
  const parsed = parsePrice(item.price);

  if (parsed === null) {
    return item.price;
  }

  if (item.priceCurrency === "USD") {
    return `$${new Intl.NumberFormat("en-US").format(parsed)}`;
  }

  return formatKztPrice(parsed);
}

export async function fetchUsdToKztRate(signal?: AbortSignal) {
  const response = await fetch(EXCHANGE_RATE_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error("Could not load exchange rate.");
  }

  const data = (await response.json()) as unknown;
  const maybeRate =
    data && typeof data === "object" && "rates" in data
      ? (data as { rates?: Record<string, unknown> }).rates?.KZT
      : undefined;

  return typeof maybeRate === "number" && Number.isFinite(maybeRate)
    ? maybeRate
    : null;
}

export async function replaceWishlist(items: WishlistItem[]) {
  const payload: WishlistDocument = {
    items,
    updatedAt: new Date().toISOString(),
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Could not save the wishlist.");
  }

  return payload;
}
