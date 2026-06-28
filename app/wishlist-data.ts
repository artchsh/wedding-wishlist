export const API_URL = "https://api.npoint.io/8771deb313d9bd0570e7";

export type WishlistItem = {
  id: string;
  title: string;
  note: string;
  url: string;
  imageUrl: string;
  category: string;
  price: string;
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
    reservedBy:
      typeof record.reservedBy === "string" ? record.reservedBy : "",
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
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
