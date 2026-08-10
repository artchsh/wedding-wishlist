"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteNav } from "@/components/site-nav";
import {
  RSVP_NAME_HINT,
  formatRsvpTimestamp,
  submitRsvp,
  triggerRsvpBackup,
  validateRsvpName,
  type RsvpRecord,
} from "../rsvp-data";

// Deliberately NOT the wishlist's guest-name key — the wishlist nickname can be
// anything, this one has to be the guest's real name.
const RSVP_NAME_STORAGE_KEY = "wedding-rsvp-name";

export function GuestRsvp() {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<RsvpRecord | null>(null);

  const nameError = validateRsvpName(name);
  const disabled = Boolean(nameError) || sending !== null;

  useEffect(() => {
    // localStorage isn't available during SSR, so this can only be read client-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(window.localStorage.getItem(RSVP_NAME_STORAGE_KEY) ?? "");
  }, []);

  async function send(attending: boolean) {
    setTouched(true);

    if (validateRsvpName(name)) return;

    setSending(attending ? "yes" : "no");
    setError("");

    const result = await submitRsvp(name, attending);

    if (!result.ok || !result.record) {
      setError(result.error ?? "Не удалось отправить ответ.");
      setSending(null);
      return;
    }

    window.localStorage.setItem(RSVP_NAME_STORAGE_KEY, result.record.name);
    setConfirmed(result.record);
    setSending(null);
    void triggerRsvpBackup();
  }

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <SiteNav />

        <header className="space-y-2">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Придёшь или нет?
          </h1>
          <p className="text-muted-foreground">
            Два варианта, одна кнопка. Нам нужно посчитать людей, а не мучить вас
            анкетами.
          </p>
        </header>

        {confirmed ? (
          <Card>
            <CardHeader>
              <CardTitle>Записали</CardTitle>
              <CardDescription>
                {formatRsvpTimestamp(confirmed.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-lg">
                <span className="font-semibold">{confirmed.name}</span> —{" "}
                {confirmed.attending ? "придёт. Ура, бля!" : "не придёт. Жаль."}
              </p>
              <p className="text-sm text-muted-foreground">
                Передумаете — просто ответьте ещё раз, мы считаем последний ответ.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmed(null)}
              >
                Ответить заново
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Ваше настоящее имя</CardTitle>
              <CardDescription>
                Имя и первая буква фамилии — как в переводе Kaspi. {RSVP_NAME_HINT}.
                Это не слейное имя из списка подарков: здесь нужно, чтобы мы поняли,
                кто именно придёт.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rsvp-name">Имя и буква фамилии</Label>
                <Input
                  id="rsvp-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                  onBlur={() => setTouched(true)}
                  placeholder="Александр П."
                  autoComplete="name"
                  aria-invalid={touched && Boolean(nameError)}
                  aria-describedby="rsvp-name-hint"
                />
                <p
                  id="rsvp-name-hint"
                  className={`text-xs ${
                    touched && nameError
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {touched && nameError
                    ? nameError
                    : `Обязательный формат: имя, пробел, первая буква фамилии. ${RSVP_NAME_HINT}`}
                </p>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={() => send(true)}
                  disabled={disabled}
                >
                  {sending === "yes" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Я приду
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={() => send(false)}
                  disabled={disabled}
                >
                  {sending === "no" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <X />
                  )}
                  Я не приду
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
