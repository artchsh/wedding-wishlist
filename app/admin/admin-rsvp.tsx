"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  countGroupPeople,
  fetchRsvps,
  formatRsvpTimestamp,
  groupRsvpsByName,
  pluralizeRu,
  RESOLUTION_NOTE_MAX,
  submitRsvpResolution,
  summarizeRsvps,
  triggerRsvpBackup,
  type RsvpNameGroup,
  type RsvpRecord,
  type RsvpResolution,
  type RsvpResolutionInput,
} from "../rsvp-data";

export function AdminRsvp() {
  const [records, setRecords] = useState<RsvpRecord[]>([]);
  const [resolutions, setResolutions] = useState<RsvpResolution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [backupSending, setBackupSending] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [resolveErrorKey, setResolveErrorKey] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState("");

  const groups = useMemo(
    () => groupRsvpsByName(records, resolutions),
    [records, resolutions]
  );
  const summary = useMemo(() => summarizeRsvps(groups), [groups]);

  useEffect(() => {
    void loadRsvps();
  }, []);

  async function loadRsvps() {
    setLoading(true);
    setError("");

    try {
      const document = await fetchRsvps();
      setRecords(document.records);
      setResolutions(document.resolutions);
    } catch {
      setError("Не удалось загрузить ответы.");
    } finally {
      setLoading(false);
    }
  }

  async function handleBackup() {
    setBackupSending(true);
    setBackupStatus("Отправка...");

    const result = await triggerRsvpBackup();
    setBackupStatus(
      result.ok ? "Бэкап RSVP отправлен в Discord." : `Ошибка: ${result.error}`
    );
    setBackupSending(false);
  }

  /**
   * Resolves to false on failure so the row can keep its controls open.
   * `resolvingKey` only tracks the in-flight spinner and clears on any
   * outcome; `resolveErrorKey` tracks which row's error to keep showing
   * once that spinner clears, so a failed save doesn't lose its message.
   */
  async function handleResolve(input: RsvpResolutionInput) {
    setResolvingKey(input.nameKey);
    setResolveErrorKey(null);
    setResolveError("");

    const result = await submitRsvpResolution(input);

    if (!result.ok || !result.resolution) {
      setResolveError(result.error ?? "Не удалось сохранить решение.");
      setResolveErrorKey(input.nameKey);
      setResolvingKey(null);
      return false;
    }

    const saved = result.resolution;
    setResolutions((current) => [...current, saved]);
    setResolvingKey(null);
    void triggerRsvpBackup();

    return true;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-3xl font-semibold tracking-tight">
            RSVP
          </h2>
          <p className="text-muted-foreground">
            Кто придёт. Считается последний ответ на каждое имя.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={loadRsvps}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Обновить
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleBackup}
            disabled={backupSending}
          >
            {backupSending ? <Loader2 className="animate-spin" /> : <Send />}
            Бэкап в Discord
          </Button>
        </div>
      </div>

      {backupStatus ? (
        <p className="text-xs text-muted-foreground">{backupStatus}</p>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {summary.coming}{" "}
            {pluralizeRu(summary.coming, ["придёт", "придут", "придут"])} /{" "}
            {summary.notComing} не{" "}
            {pluralizeRu(summary.notComing, ["придёт", "придут", "придут"])}
          </CardTitle>
          <CardDescription>
            {summary.names}{" "}
            {pluralizeRu(summary.names, ["имя", "имени", "имён"])},{" "}
            {records.length}{" "}
            {pluralizeRu(records.length, ["ответ", "ответа", "ответов"])} всего
            {summary.needsReview
              ? ` · ${summary.needsReview} нужно разобрать`
              : ""}
            {summary.stale ? ` · ${summary.stale} с новыми ответами` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <RsvpSkeleton />
          ) : groups.length ? (
            groups.map((group) => (
              <RsvpGroupRow
                key={group.key}
                group={group}
                busy={resolvingKey === group.key}
                error={resolveErrorKey === group.key ? resolveError : ""}
                onResolve={handleResolve}
              />
            ))
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              Ответов пока нет.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function RsvpGroupRow({
  group,
  busy,
  error,
  onResolve,
}: {
  group: RsvpNameGroup;
  busy: boolean;
  error: string;
  onResolve: (input: RsvpResolutionInput) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"none" | "single" | "split">("none");
  const [note, setNote] = useState("");
  const [attending, setAttending] = useState(group.latest.attending);
  const [coming, setComing] = useState(
    () => countGroupPeople({ ...group, resolution: null }).coming
  );
  const [notComing, setNotComing] = useState(
    () => countGroupPeople({ ...group, resolution: null }).notComing
  );

  const counts = countGroupPeople(group);
  const unresolved = group.needsReview && !group.resolution;
  const showHistory = group.needsReview || group.answerChanges > 0;
  const border = group.resolutionStale
    ? "border-amber-500/60"
    : unresolved
      ? "border-destructive/60 bg-destructive/5"
      : "";

  function openSingle() {
    setAttending(group.latest.attending);
    setNote("");
    setMode("single");
  }

  function openSplit() {
    const fresh = countGroupPeople({ ...group, resolution: null });
    setComing(fresh.coming);
    setNotComing(fresh.notComing);
    setNote("");
    setMode("split");
  }

  // Only closes on success — a failed write keeps the entered values on screen.
  async function save(kind: "single" | "split") {
    const saved = await onResolve({
      nameKey: group.key,
      kind,
      attending: kind === "single" ? attending : false,
      coming: kind === "split" ? coming : 0,
      notComing: kind === "split" ? notComing : 0,
      note,
    });

    if (saved) {
      setMode("none");
    }
  }

  return (
    <div className={`space-y-2 border p-3 ${border}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{group.name}</span>
          <Badge variant={counts.coming ? "default" : "secondary"}>
            {counts.coming}{" "}
            {pluralizeRu(counts.coming, ["придёт", "придут", "придут"])} /{" "}
            {counts.notComing} нет
          </Badge>
          {unresolved ? (
            <Badge variant="destructive">
              <AlertTriangle />
              Ответы с {group.submitters.length} устройств
            </Badge>
          ) : null}
          {group.resolutionStale ? (
            <Badge variant="outline">
              <AlertTriangle />
              После решения пришли новые ответы
            </Badge>
          ) : null}
          {group.answerChanges > 0 && !group.needsReview ? (
            <span className="text-xs text-muted-foreground">
              менял(а) ответ {group.answerChanges}{" "}
              {pluralizeRu(group.answerChanges, ["раз", "раза", "раз"])}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRsvpTimestamp(group.latest.createdAt)}
        </span>
      </div>

      {group.resolution ? (
        <p className="text-xs text-muted-foreground">
          Решено:{" "}
          {group.resolution.kind === "single"
            ? `один человек, ${group.resolution.attending ? "придёт" : "не придёт"}`
            : `${group.resolution.coming} ${pluralizeRu(group.resolution.coming, ["придёт", "придут", "придут"])}, ${group.resolution.notComing} нет`}
          {group.resolution.note ? ` — ${group.resolution.note}` : ""}
        </p>
      ) : null}

      {showHistory ? (
        <>
          <Separator />
          {(() => {
            let deviceNumber = 0;
            return group.submitters.map((submitter) => {
              if (submitter.submitterId) {
                deviceNumber += 1;
              }

              return (
                <div
                  key={submitter.submitterId || "legacy"}
                  className="space-y-1"
                >
                  <p className="text-xs font-medium">
                    {submitter.submitterId
                      ? `Устройство ${deviceNumber}`
                      : "Старые ответы (без устройства)"}
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {submitter.records.map((record) => (
                      <li
                        key={record.id}
                        className="flex justify-between gap-3"
                      >
                        <span>
                          {record.attending ? "придёт" : "не придёт"}
                        </span>
                        <span>{formatRsvpTimestamp(record.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            });
          })()}
        </>
      ) : null}

      {group.needsReview ? (
        <>
          {mode === "none" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={openSingle}
              >
                Это один человек
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={openSplit}
              >
                Разные люди
              </Button>
            </div>
          ) : null}

          {mode === "single" ? (
            <div className="space-y-2 border p-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={attending ? "default" : "outline"}
                  onClick={() => setAttending(true)}
                >
                  Придёт
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={attending ? "outline" : "default"}
                  onClick={() => setAttending(false)}
                >
                  Не придёт
                </Button>
              </div>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Заметка (необязательно)"
                maxLength={RESOLUTION_NOTE_MAX}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save("single")}
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Сохранить
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("none")}
                >
                  Отмена
                </Button>
              </div>
            </div>
          ) : null}

          {mode === "split" ? (
            <div className="space-y-2 border p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Label htmlFor={`coming-${group.key}`}>Придут</Label>
                <Input
                  id={`coming-${group.key}`}
                  type="number"
                  min={0}
                  className="w-20"
                  value={coming}
                  onChange={(event) =>
                    setComing(Math.max(0, Number(event.target.value) || 0))
                  }
                />
                <Label htmlFor={`not-coming-${group.key}`}>Не придут</Label>
                <Input
                  id={`not-coming-${group.key}`}
                  type="number"
                  min={0}
                  className="w-20"
                  value={notComing}
                  onChange={(event) =>
                    setNotComing(Math.max(0, Number(event.target.value) || 0))
                  }
                />
              </div>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Кто есть кто (необязательно)"
                maxLength={RESOLUTION_NOTE_MAX}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || coming + notComing < 2}
                  onClick={() => void save("split")}
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Сохранить
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("none")}
                >
                  Отмена
                </Button>
              </div>
              {coming + notComing < 2 ? (
                <p className="text-xs text-muted-foreground">
                  Разных людей должно быть хотя бы двое.
                </p>
              ) : null}
            </div>
          ) : null}

          {error && mode !== "none" ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RsvpSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
