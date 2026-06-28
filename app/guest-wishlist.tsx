"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
  fetchWishlist,
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
  const [message, setMessage] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [messageType, setMessageType] = useState<"default" | "destructive">(
    "default"
  );

  const visibleItems = useMemo(
    () => filterItemsByPrice(items, minPrice, maxPrice),
    [items, minPrice, maxPrice]
  );
  const openCount = useMemo(
    () => visibleItems.filter((item) => !item.reservedBy).length,
    [visibleItems]
  );
  const categoryGroups = useMemo(
    () => groupItemsByCategory(visibleItems),
    [visibleItems]
  );
  useEffect(() => {
    const controller = new AbortController();

    fetchWishlist(controller.signal)
      .then((document) => {
        setItems(document.items.length ? document.items : starterItems);
      })
      .catch(() => {
        setItems(starterItems);
        setMessage("Не удалось загрузить актуальный список. Показаны примеры.");
        setMessageType("destructive");
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

    if (!name) {
      setMessage("Введите имя перед бронированием подарка.");
      setMessageType("destructive");
      return;
    }

    const nextItems = items.map((item) =>
      item.id === itemId && !item.reservedBy
        ? { ...item, reservedBy: name }
        : item
    );

    setSavingId(itemId);
    setMessage("");

    try {
      await replaceWishlist(nextItems);
      setItems(nextItems);
      setMessage("Подарок забронирован. Спасибо!");
      setMessageType("default");
    } catch {
      setMessage("Не удалось забронировать подарок. Попробуйте еще раз.");
      setMessageType("destructive");
    } finally {
      setSavingId(null);
    }
  }

  async function cancelReservation(itemId: string) {
    const name = guestName.trim();

    if (!name) {
      setMessage("Введите имя, чтобы снять свою бронь.");
      setMessageType("destructive");
      return;
    }

    const nextItems = items.map((item) =>
      item.id === itemId && isReservedByCurrentGuest(item, name)
        ? { ...item, reservedBy: "" }
        : item
    );

    setSavingId(itemId);
    setMessage("");

    try {
      await replaceWishlist(nextItems);
      setItems(nextItems);
      setMessage("Бронь снята.");
      setMessageType("default");
    } catch {
      setMessage("Не удалось снять бронь. Попробуйте еще раз.");
      setMessageType("destructive");
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
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
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
                Нужно только для отображения брони.
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

        {message ? (
          <Alert variant={messageType}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Подарки
              </h2>
              <p className="text-sm text-muted-foreground">
                Свободно {openCount} из {visibleItems.length}
              </p>
            </div>
            {/* {categoryGroups.length ? (
              <div className="flex flex-wrap gap-2">
                {categoryGroups.map((group) => (
                  <Badge key={group.category} variant="outline">
                    {group.category}
                  </Badge>
                ))}
              </div>
            ) : null} */}
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
                  placeholder="50000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-price">Макс. цена</Label>
                <Input
                  id="max-price"
                  inputMode="numeric"
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value)}
                  placeholder="150000"
                />
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <GiftSkeletonGrid />
          ) : visibleItems.length ? (
            <div className="space-y-8">
              {categoryGroups.map((group) => (
                <section key={group.category} className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold tracking-tight">
                        {group.category}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {group.items.filter((item) => !item.reservedBy).length}{" "}
                        из {group.items.length} свободно
                      </p>
                    </div>
                  </div>
                  <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
                    <div className="flex snap-x snap-mandatory gap-4 sm:grid sm:snap-none sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <GiftCard
                          key={item.id}
                          item={item}
                          guestName={guestName}
                          saving={savingId === item.id}
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
                По выбранным фильтрам подарков нет.
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
  onReserve,
  onCancelReservation,
}: {
  item: WishlistItem;
  guestName: string;
  saving: boolean;
  onReserve: () => void;
  onCancelReservation: () => void;
}) {
  const reserved = Boolean(item.reservedBy);
  const reservedByCurrentGuest = isReservedByCurrentGuest(item, guestName);

  return (
    <Card
      className={`w-[82vw] shrink-0 snap-start sm:w-auto ${reserved ? "opacity-70" : ""}`}
    >
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.title}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : null}
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.note || "Подарок из вишлиста"}</CardDescription>
        <CardAction>
          <Badge variant={reserved ? "secondary" : "default"}>
            {reserved ? "Занято" : "Свободно"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.price ? (
          <p className="text-sm font-medium">Цена: {formatKztPrice(item.price)}</p>
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
        {reserved && !reservedByCurrentGuest ? (
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
            disabled={saving}
            className="flex-1"
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            Забронировать
          </Button>
        ) : (
          null
        )}
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
      if (first.category === "Другое") {
        return 1;
      }

      if (second.category === "Другое") {
        return -1;
      }

      return first.category.localeCompare(second.category, "ru");
    });
}

function filterItemsByPrice(
  items: WishlistItem[],
  minPrice: string,
  maxPrice: string
) {
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);

  return items.filter((item) => {
    const price = parsePrice(item.price);

    if (price === null) {
      return min === null && max === null;
    }

    if (min !== null && price < min) {
      return false;
    }

    if (max !== null && price > max) {
      return false;
    }

    return true;
  });
}

function parsePrice(value: string) {
  const normalized = value.replace(/[^\d]/g, "");
  const parsed = Number.parseInt(normalized, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatKztPrice(value: string) {
  const parsed = parsePrice(value);

  if (parsed === null) {
    return value;
  }

  return `${new Intl.NumberFormat("ru-KZ").format(parsed)} ₸`;
}

function GiftSkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-28" />
          </CardContent>
          <CardFooter>
            <Skeleton className="h-8 w-full" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
