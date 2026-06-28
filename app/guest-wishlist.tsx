"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchUsdToKztRate,
  formatDeliveryEstimate,
  fetchWishlist,
  formatKztPrice,
  formatOriginalPrice,
  getPriceInKzt,
  parsePrice,
  replaceWishlist,
  starterItems,
  type WishlistItem,
} from "./wishlist-data";

const GUEST_NAME_STORAGE_KEY = "wedding-wishlist-guest-name";

export function GuestWishlist() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [guestName, setGuestName] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) ?? "";
  });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);

  const visibleItems = useMemo(
    () => filterItemsByPrice(items, minPrice, maxPrice, usdToKztRate),
    [items, minPrice, maxPrice, usdToKztRate]
  );
  const openCount = useMemo(
    () => visibleItems.filter((item) => !item.reservedBy).length,
    [visibleItems]
  );
  const categoryGroups = useMemo(
    () => groupItemsByCategory(visibleItems),
    [visibleItems]
  );
  const filtersActive = Boolean(minPrice || maxPrice);

  useEffect(() => {
    const controller = new AbortController();

    Promise.allSettled([
      fetchWishlist(controller.signal),
      fetchUsdToKztRate(controller.signal),
    ])
      .then(([wishlistResult, rateResult]) => {
        if (wishlistResult.status === "fulfilled") {
          const document = wishlistResult.value;
          setItems(document.items.length ? document.items : starterItems);
        } else {
          setItems(starterItems);
        }

        if (rateResult.status === "fulfilled") {
          setUsdToKztRate(rateResult.value);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const name = guestName.trim();

    if (name) {
      window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, name);
    } else {
      window.localStorage.removeItem(GUEST_NAME_STORAGE_KEY);
    }
  }, [guestName]);

  async function reserveGift(itemId: string) {
    const name = guestName.trim();

    if (!name) return;

    const nextItems = items.map((item) =>
      item.id === itemId && !item.reservedBy
        ? { ...item, reservedBy: name }
        : item
    );

    setSavingId(itemId);

    try {
      await replaceWishlist(nextItems);
      setItems(nextItems);
    } finally {
      setSavingId(null);
    }
  }

  async function cancelReservation(itemId: string) {
    const name = guestName.trim();

    if (!name) return;

    const nextItems = items.map((item) =>
      item.id === itemId && isReservedByCurrentGuest(item, name)
        ? { ...item, reservedBy: "" }
        : item
    );

    setSavingId(itemId);

    try {
      await replaceWishlist(nextItems);
      setItems(nextItems);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end">
          <div className="space-y-3">
            <Badge variant="secondary">Свадебный вишлист</Badge>
            <div className="space-y-2">
              <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Выберите свадебный подарок
              </h1>
              <p className="max-w-2xl text-muted-foreground">
                Введите имя, выберите свободный подарок и забронируйте его для
                пары.
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ваше имя</CardTitle>
              <CardDescription>
                Нужно для бронирования подарка.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Label htmlFor="guest-name">Имя</Label>
              <Input
                id="guest-name"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="Ваше имя"
                className="mt-2"
              />
            </CardContent>
          </Card>
        </header>

        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              Подарки
            </h2>
            <p className="text-sm text-muted-foreground">
              Свободно {openCount} из {visibleItems.length}
            </p>
          </div>

          <Card>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="min-price">Мин. цена</Label>
                <Input
                  id="min-price"
                  inputMode="numeric"
                  value={minPrice}
                  onChange={(event) => setMinPrice(event.target.value)}
                  placeholder="50 000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-price">Макс. цена</Label>
                <Input
                  id="max-price"
                  inputMode="numeric"
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value)}
                  placeholder="150 000"
                />
              </div>
              {filtersActive ? (
                <div className="col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMinPrice("");
                      setMaxPrice("");
                    }}
                    className="h-auto px-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="mr-1 h-3 w-3" />
                    Сбросить фильтры
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {loading ? (
            <GiftSkeletonGrid />
          ) : visibleItems.length ? (
            <div className="space-y-8">
              {categoryGroups.map((group) => (
                <section key={group.category} className="space-y-3">
                  <div>
                    <h3 className="font-heading text-xl font-semibold tracking-tight">
                      {group.category}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {group.items.filter((item) => !item.reservedBy).length} из{" "}
                      {group.items.length} свободно
                    </p>
                  </div>
                  <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
                    <div className="flex snap-x snap-mandatory gap-4 pt-2 sm:grid sm:snap-none sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <GiftCard
                          key={item.id}
                          item={item}
                          guestName={guestName}
                          saving={savingId === item.id}
                          usdToKztRate={usdToKztRate}
                          onReserve={() => reserveGift(item.id)}
                          onCancelReservation={() => cancelReservation(item.id)}
                        />
                      ))}
                      <div className="w-1 shrink-0 sm:hidden" aria-hidden="true" />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                {filtersActive
                  ? "По выбранным фильтрам подарков нет."
                  : "Подарков пока нет."}
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

function GiftCard({
  item,
  guestName,
  saving,
  usdToKztRate,
  onReserve,
  onCancelReservation,
}: {
  item: WishlistItem;
  guestName: string;
  saving: boolean;
  usdToKztRate: number | null;
  onReserve: () => void;
  onCancelReservation: () => void;
}) {
  const reserved = Boolean(item.reservedBy);
  const reservedByCurrentGuest = isReservedByCurrentGuest(item, guestName);
  const reservedByOther = reserved && !reservedByCurrentGuest;
  const noName = !guestName.trim();

  return (
    <Card
      className={`w-[82vw] shrink-0 snap-start sm:w-auto pt-0 ${
        reservedByCurrentGuest
          ? "ring-2 ring-primary/40"
          : reservedByOther
            ? "opacity-60"
            : ""
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Изображение не добавлено
          </div>
        )}
        <div className="absolute right-3 top-3">
          {reservedByCurrentGuest ? (
            <Badge variant="default" className="shadow-sm">
              Вы забронировали
            </Badge>
          ) : (
            <Badge
              variant={reserved ? "secondary" : "outline"}
              className="bg-background/90 shadow-sm backdrop-blur"
            >
              {reserved ? "Занято" : "Свободно"}
            </Badge>
          )}
        </div>
      </div>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.note || "Подарок из вишлиста"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {item.deliveryEstimate ? (
          <Badge variant="secondary">
            {formatDeliveryEstimate(item.deliveryEstimate)}
          </Badge>
        ) : null}
        {item.price ? (
          <p className="text-sm font-medium">
            Цена: {formatDisplayPrice(item, usdToKztRate)}
          </p>
        ) : null}
        {noName && !reserved ? (
          <p className="text-xs text-muted-foreground">
            Введите имя выше для бронирования
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="gap-2">
        {item.url ? (
          <Button asChild variant="outline" className="flex-1">
            <a href={item.url} target="_blank" rel="noreferrer">
              Магазин
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        ) : null}
        {reservedByOther ? (
          <p className="flex-1 text-sm text-muted-foreground">
            Забронировано: {item.reservedBy}
          </p>
        ) : null}
        {reservedByCurrentGuest ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancelReservation}
            disabled={saving}
            className="flex-1"
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            Снять бронь
          </Button>
        ) : null}
        {!reserved ? (
          <Button
            type="button"
            onClick={onReserve}
            disabled={saving || noName}
            className="flex-1"
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            Забронировать
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function isReservedByCurrentGuest(item: WishlistItem, guestName: string) {
  const currentGuest = guestName.trim().toLocaleLowerCase("ru");
  const reservedBy = item.reservedBy.trim().toLocaleLowerCase("ru");

  return Boolean(currentGuest && reservedBy && currentGuest === reservedBy);
}

function groupItemsByCategory(items: WishlistItem[]) {
  const groups = new Map<string, WishlistItem[]>();

  for (const item of items) {
    const category = item.category.trim() || "Другое";
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }

  return Array.from(groups.entries())
    .map(([category, groupItems]) => ({ category, items: groupItems }))
    .sort((first, second) => {
      if (first.category === "Другое") return 1;
      if (second.category === "Другое") return -1;

      return first.category.localeCompare(second.category, "ru");
    });
}

function filterItemsByPrice(
  items: WishlistItem[],
  minPrice: string,
  maxPrice: string,
  usdToKztRate: number | null
) {
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);

  return items.filter((item) => {
    const price = getPriceInKzt(item, usdToKztRate);

    if (price === null) {
      return min === null && max === null;
    }

    if (min !== null && price < min) return false;
    if (max !== null && price > max) return false;

    return true;
  });
}

function formatDisplayPrice(item: WishlistItem, usdToKztRate: number | null) {
  const priceInKzt = getPriceInKzt(item, usdToKztRate);

  if (priceInKzt !== null) {
    return formatKztPrice(priceInKzt);
  }

  return formatOriginalPrice(item);
}

function GiftSkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <Skeleton className="aspect-[4/3] w-full rounded-none rounded-t-xl" />
          <CardHeader>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
          <CardFooter>
            <Skeleton className="h-8 w-full" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
