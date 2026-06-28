"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchWishlist,
  formatDeliveryEstimate,
  formatOriginalPrice,
  type DeliveryEstimate,
  type PriceCurrency,
  replaceWishlist,
  starterItems,
  type WishlistItem,
} from "../wishlist-data";

const emptyForm = {
  title: "",
  note: "",
  url: "",
  imageUrl: "",
  category: "",
  price: "",
  priceCurrency: "KZT" as PriceCurrency,
  deliveryEstimate: "" as DeliveryEstimate,
};

export function AdminWishlist() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState("Загрузка списка...");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | undefined>();

  const reservedCount = items.filter((item) => item.reservedBy).length;
  const openCount = items.length - reservedCount;
  const syncLabel = useMemo(() => formatDate(lastUpdated), [lastUpdated]);
  const categories = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.category).filter(Boolean))
      ).sort((first, second) => first.localeCompare(second, "ru")),
    [items]
  );

  useEffect(() => {
    void loadWishlist();
  }, []);

  async function loadWishlist() {
    setLoading(true);
    setError("");

    try {
      const document = await fetchWishlist();
      setItems(document.items.length ? document.items : starterItems);
      setLastUpdated(document.updatedAt);
      setStatus(
        document.items.length
          ? "Список загружен."
          : "Загружены примеры. Сохраните изменение, чтобы опубликовать."
      );
    } catch {
      setItems(starterItems);
      setStatus("Загружены примеры.");
      setError("Не удалось загрузить удаленный список.");
    } finally {
      setLoading(false);
    }
  }

  async function persist(nextItems: WishlistItem[], busyId: string) {
    setSavingId(busyId);
    setError("");
    setStatus("Сохранение изменений...");

    try {
      const document = await replaceWishlist(nextItems);
      setItems(nextItems);
      setLastUpdated(document.updatedAt);
      setStatus("Изменения сохранены.");
    } catch {
      setError("Не удалось сохранить изменения.");
      setStatus("Ошибка сохранения.");
    } finally {
      setSavingId(null);
    }
  }

  async function addGift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = form.title.trim();
    if (!title) {
      setError("Название подарка обязательно.");
      return;
    }

    const nextItem: WishlistItem = {
      id: crypto.randomUUID(),
      title,
      note: form.note.trim(),
      url: form.url.trim(),
      imageUrl: form.imageUrl.trim(),
      category: form.category.trim(),
      price: form.price.trim(),
      priceCurrency: form.priceCurrency,
      deliveryEstimate: form.deliveryEstimate,
      reservedBy: "",
      createdAt: new Date().toISOString(),
    };

    await persist([nextItem, ...items], "new");
    setForm(emptyForm);
  }

  async function deleteGift(itemId: string) {
    setConfirmDeleteId(null);
    await persist(
      items.filter((item) => item.id !== itemId),
      itemId
    );
  }

  async function releaseGift(itemId: string) {
    await persist(
      items.map((item) =>
        item.id === itemId ? { ...item, reservedBy: "" } : item
      ),
      itemId
    );
  }

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Админ</CardTitle>
              <CardDescription>Добавление и управление подарками.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Metric label="Всего" value={items.length} />
                <Metric label="Свободно" value={openCount} />
                <Metric label="Занято" value={reservedCount} />
              </div>
              <Separator />
              <div className="space-y-1 text-sm">
                <p>{status}</p>
                <p className="text-muted-foreground">Сохранено: {syncLabel}</p>
              </div>
              {categories.length ? (
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Badge key={category} variant="outline">
                      {category}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={loadWishlist}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  Обновить
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/">Смотреть сайт</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Добавить подарок</CardTitle>
              <CardDescription>
                Новые подарки появятся на главной странице.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={addGift}>
                <Field label="Название подарка" htmlFor="title">
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                    placeholder="Робот-пылесос"
                    required
                  />
                </Field>
                <Field label="Ссылка на магазин" htmlFor="url">
                  <Input
                    id="url"
                    type="url"
                    value={form.url}
                    onChange={(event) =>
                      setForm({ ...form, url: event.target.value })
                    }
                    placeholder="https://..."
                  />
                </Field>
                <Field label="Ссылка на изображение" htmlFor="imageUrl">
                  <Input
                    id="imageUrl"
                    type="url"
                    value={form.imageUrl}
                    onChange={(event) =>
                      setForm({ ...form, imageUrl: event.target.value })
                    }
                    placeholder="https://example.com/image.jpg"
                  />
                  {form.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.imageUrl}
                      alt="Предпросмотр"
                      className="mt-2 aspect-[4/3] w-full rounded-md object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                      onLoad={(e) => {
                        (e.target as HTMLImageElement).style.display = "block";
                      }}
                    />
                  ) : null}
                </Field>
                <Field label="Категория" htmlFor="category">
                  <Input
                    id="category"
                    value={form.category}
                    onChange={(event) =>
                      setForm({ ...form, category: event.target.value })
                    }
                    placeholder="Кухня, Дом, Путешествия..."
                    list="category-suggestions"
                  />
                  {categories.length ? (
                    <datalist id="category-suggestions">
                      {categories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  ) : null}
                </Field>
                <Field label="Цена" htmlFor="price">
                  <Input
                    id="price"
                    value={form.price}
                    onChange={(event) =>
                      setForm({ ...form, price: event.target.value })
                    }
                    placeholder={
                      form.priceCurrency === "USD" ? "250" : "150 000"
                    }
                  />
                </Field>
                <Field label="Валюта" htmlFor="priceCurrency">
                  <select
                    id="priceCurrency"
                    value={form.priceCurrency}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        priceCurrency: event.target.value as PriceCurrency,
                      })
                    }
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="KZT">₸ KZT</option>
                    <option value="USD">$ USD</option>
                  </select>
                </Field>
                <Field label="Доставка" htmlFor="deliveryEstimate">
                  <select
                    id="deliveryEstimate"
                    value={form.deliveryEstimate}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        deliveryEstimate: event.target
                          .value as DeliveryEstimate,
                      })
                    }
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="">Не указано</option>
                    <option value="SHORT">
                      {formatDeliveryEstimate("SHORT")}
                    </option>
                    <option value="LONG">
                      {formatDeliveryEstimate("LONG")}
                    </option>
                  </select>
                </Field>
                <Field label="Описание" htmlFor="note">
                  <Textarea
                    id="note"
                    value={form.note}
                    onChange={(event) =>
                      setForm({ ...form, note: event.target.value })
                    }
                    placeholder="Полезные детали для гостей."
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={savingId === "new"}
                  className="w-full"
                >
                  {savingId === "new" ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  Добавить подарок
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              Список подарков
            </h1>
            <p className="text-muted-foreground">
              Просмотр брони, снятие брони и удаление подарков.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <InventorySkeleton />
          ) : items.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <InventoryCard
                  key={item.id}
                  item={item}
                  busy={savingId === item.id}
                  confirming={confirmDeleteId === item.id}
                  onDelete={() => deleteGift(item.id)}
                  onConfirmDelete={() => setConfirmDeleteId(item.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onRelease={() => releaseGift(item.id)}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Подарки еще не добавлены.
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

function InventoryCard({
  item,
  busy,
  confirming,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onRelease,
}: {
  item: WishlistItem;
  busy: boolean;
  confirming: boolean;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onRelease: () => void;
}) {
  const reserved = Boolean(item.reservedBy);

  return (
    <Card>
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
          <Badge
            variant={reserved ? "secondary" : "default"}
            className="shadow-sm"
          >
            {reserved ? "Занято" : "Свободно"}
          </Badge>
        </div>
      </div>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.note || "Описание не добавлено."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {item.category ? (
          <Badge variant="outline">{item.category}</Badge>
        ) : null}
        {item.deliveryEstimate ? (
          <Badge variant="secondary">
            {formatDeliveryEstimate(item.deliveryEstimate)}
          </Badge>
        ) : null}
        {item.price ? (
          <p className="text-sm font-medium">Цена: {formatOriginalPrice(item)}</p>
        ) : null}
        {reserved ? (
          <p className="text-sm text-muted-foreground">
            Забронировано: {item.reservedBy}
          </p>
        ) : null}
        {item.url ? (
          <Button asChild variant="link" className="h-auto p-0">
            <a href={item.url} target="_blank" rel="noreferrer">
              Открыть магазин
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        ) : null}
      </CardContent>
      <CardFooter className="gap-2 flex-wrap">
        {reserved ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRelease}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <X />}
            Снять бронь
          </Button>
        ) : null}
        {confirming ? (
          <>
            <span className="text-xs text-muted-foreground">Удалить?</span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              Да
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelDelete}
              disabled={busy}
            >
              Отмена
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onConfirmDelete}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Удалить
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function InventorySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <Skeleton className="aspect-[4/3] w-full rounded-none rounded-t-xl" />
          <CardHeader>
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
          <CardFooter className="gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

function formatDate(value: string | undefined) {
  if (!value) {
    return "Никогда";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Никогда";
  }

  return new Intl.DateTimeFormat("ru-KZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
