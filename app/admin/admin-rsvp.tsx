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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchRsvps,
  formatRsvpTimestamp,
  groupRsvpsByName,
  pluralizeRu,
  summarizeRsvps,
  triggerRsvpBackup,
  type RsvpNameGroup,
  type RsvpRecord,
} from "../rsvp-data";

export function AdminRsvp() {
  const [records, setRecords] = useState<RsvpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [backupSending, setBackupSending] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");

  const groups = useMemo(() => groupRsvpsByName(records), [records]);
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
            {summary.coming} придут / {summary.notComing} не придут
          </CardTitle>
          <CardDescription>
            {summary.names}{" "}
            {pluralizeRu(summary.names, ["имя", "имени", "имён"])},{" "}
            {records.length}{" "}
            {pluralizeRu(records.length, ["ответ", "ответа", "ответов"])} всего
            {summary.needsReview
              ? ` · ${summary.needsReview} ${pluralizeRu(summary.needsReview, [
                  "имя",
                  "имени",
                  "имён",
                ])} с ответами с разных устройств — проверьте вручную`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <RsvpSkeleton />
          ) : groups.length ? (
            groups.map((group) => (
              <RsvpGroupRow key={group.key} group={group} />
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

function RsvpGroupRow({ group }: { group: RsvpNameGroup }) {
  const flagged = group.needsReview;

  return (
    <div className={`space-y-2 border p-3 ${flagged ? "border-amber-500/60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{group.name}</span>
          <Badge variant={group.latest.attending ? "default" : "secondary"}>
            {group.latest.attending ? "Придёт" : "Не придёт"}
          </Badge>
          {flagged ? (
            <Badge variant="outline">
              <AlertTriangle />
              Ответы с {group.submitters.length} устройств
            </Badge>
          ) : group.answerChanges > 0 ? (
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

      {flagged || group.answerChanges > 0 ? (
        <>
          <Separator />
          <ul className="space-y-1 text-xs text-muted-foreground">
            {group.records.map((record) => (
              <li key={record.id} className="flex justify-between gap-3">
                <span>
                  {record.name} — {record.attending ? "придёт" : "не придёт"}
                </span>
                <span>{formatRsvpTimestamp(record.createdAt)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Может быть один человек, который передумал, или два разных гостя с
            одинаковым именем — разберитесь по своему списку гостей.
          </p>
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
