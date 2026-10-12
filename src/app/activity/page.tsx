"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import LoginPrompt from "@/components/LoginPrompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ImportBatch } from "@/lib/api";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/forms";

const when = (iso: string) => new Date(iso).toLocaleString("pl-PL", { dateStyle: "long", timeStyle: "short" });

const entries = (n: number) =>
  n === 1 ? "1 wpis" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? `${n} wpisy` : `${n} wpisów`;

const fileLabel = (b: ImportBatch) => b.file_name || "Import bez nazwy pliku";

/** Historia zdarzeń: operacje wykonane na koncie, które można sprawdzić i cofnąć. Na razie importy wyciągów. */
export default function ActivityPage() {
  const { ready, loggedIn, profile } = useApp();
  const [imports, setImports] = useState<ImportBatch[] | null>(null);
  // import, przy którym czeka potwierdzenie cofnięcia
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<{ items: ImportBatch[] }>("/imports")
        .then((r) => setImports(r.items))
        .catch((e) => {
          toast.error(errorMessage(e, "Nie udało się pobrać historii zdarzeń"));
          setImports([]);
        }),
    [],
  );

  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn, load]);

  if (!ready) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!loggedIn) return <LoginPrompt what="Historia zdarzeń" />;

  const currency = profile?.currency ?? "PLN";

  async function undo(b: ImportBatch) {
    setBusy(true);
    try {
      const res = await api<{ deleted: number }>(`/imports/${b.id}`, { method: "DELETE" });
      setConfirmId(null);
      toast.success(`Import cofnięty: z rejestru usunięto ${entries(res.deleted)}`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się cofnąć importu"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Historia zdarzeń</h1>
        <p className="text-sm text-muted-foreground">
          Operacje wykonane na Twoim koncie, które możesz sprawdzić i cofnąć. Na razie są tu importy wyciągów z banku.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importy</CardTitle>
          <CardDescription>
            Cofnięcie importu usuwa z rejestru wydatki, które dopisał. Ten sam plik można potem zaimportować ponownie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {imports === null && <Skeleton className="h-24 w-full" />}
          {imports?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nie ma jeszcze żadnych importów. Wyciąg zaimportujesz na stronie Wydatki.</p>
          )}
          {imports && imports.length > 0 && (
            <ul className="divide-y" data-testid="import-history">
              {imports.map((b) => {
                const undone = b.undone_at != null;
                return (
                  <li key={b.id} className="grid gap-2 py-3" data-testid={`import-${b.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="break-all font-medium">{fileLabel(b)}</p>
                        <p className="text-xs text-muted-foreground">
                          {when(b.imported_at)} · dopisano {entries(b.created)} na {money(b.total, currency)}
                          {b.skipped > 0 && `, pominięto ${b.skipped} (już były w rejestrze)`}
                        </p>
                        {!undone && b.remaining < b.created && (
                          <p className="text-xs text-muted-foreground">
                            W rejestrze {b.remaining === 1 ? "został" : "zostało"} {b.remaining} z {b.created}; resztę usunięto ręcznie.
                          </p>
                        )}
                      </div>
                      {undone ? (
                        <Badge variant="secondary">cofnięty {when(b.undone_at!)}</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={b.remaining === 0}
                          aria-expanded={confirmId === b.id}
                          aria-label={`Cofnij import ${fileLabel(b)} z ${when(b.imported_at)}`}
                          onClick={() => setConfirmId(confirmId === b.id ? null : b.id)}
                        >
                          Cofnij import
                        </Button>
                      )}
                    </div>
                    {confirmId === b.id && !undone && (
                      <div className="grid gap-2 rounded-lg bg-muted/60 p-3 text-sm" role="group" aria-label={`Potwierdź cofnięcie importu: ${fileLabel(b)}`}>
                        <p>
                          Cofnąć import „{fileLabel(b)}” z {when(b.imported_at)}? Z rejestru {b.remaining === 1 ? "zniknie" : "znikną"}{" "}
                          <b>{entries(b.remaining)}</b>, także te, które później zmieniłeś. Tego nie da się odwrócić inaczej niż ponownym importem pliku.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void undo(b)}>
                            Tak, cofnij import
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                            Anuluj
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
