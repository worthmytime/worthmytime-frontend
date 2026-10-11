"use client";

import { FileUpIcon, SparklesIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Category } from "@/lib/api";
import { CATEGORY_INFO, money } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage } from "@/lib/forms";
import { suggestCategories } from "@/lib/ai";
import { decodeStatement, loadRules, parseStatement, saveRules, type ImportedExpense, type ImportTx, type ParsedStatement } from "@/lib/ipko";
import { cn } from "@/lib/utils";

type Choice = Category | "SKIP" | undefined;

interface Group {
  key: string;
  label: string;
  items: ImportTx[];
  total: number;
}

interface Props {
  currency: string;
  onImport: (items: ImportedExpense[]) => Promise<{ created: number; skipped: number }>;
}

/** Import wyciągu z banku (iPKO, CSV): transakcje grupujemy po sprzedawcy, a kategorię przypisuje użytkownik (kategorie są zapamiętywane). */
export default function ImportButton({ currency, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [includePending, setIncludePending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = await parseStatement(decodeStatement(await file.arrayBuffer()));
      const rules = loadRules();
      const initial: Record<string, Choice> = {};
      for (const t of parsed.transactions) if (rules[t.merchantKey]) initial[t.merchantKey] = rules[t.merchantKey];
      setChoices(initial);
      setFileName(file.name);
      setStatement(parsed);
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się odczytać pliku"));
    } finally {
      if (fileRef.current) fileRef.current.value = ""; // pozwala wybrać ten sam plik jeszcze raz
    }
  }

  const used = (statement?.transactions ?? []).filter((t) => includePending || !t.pending);
  const pendingCount = (statement?.transactions ?? []).filter((t) => t.pending).length;
  const groups: Group[] = [];
  for (const t of used) {
    let g = groups.find((x) => x.key === t.merchantKey);
    if (!g) groups.push((g = { key: t.merchantKey, label: t.merchant, items: [], total: 0 }));
    g.items.push(t);
    g.total += t.amount;
  }
  groups.sort((a, b) => b.total - a.total);

  const unassigned = groups.filter((g) => !choices[g.key]).length;
  const toImport = groups.filter((g) => choices[g.key] && choices[g.key] !== "SKIP");
  const importCount = toImport.reduce((s, g) => s + g.items.length, 0);
  const importTotal = toImport.reduce((s, g) => s + g.total, 0);

  async function suggestAll() {
    const unassignedGroups = groups.filter((g) => !choices[g.key]);
    if (!unassignedGroups.length) return;
    setSuggesting(true);
    try {
      const suggestions = await suggestCategories(
        unassignedGroups.map((g) => ({ key: g.key, description: g.label })),
      );
      setChoices((prev) => ({ ...prev, ...suggestions }));
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się zasugerować kategorii"));
    } finally {
      setSuggesting(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const items: ImportedExpense[] = toImport.flatMap((g) =>
        g.items.map((t) => ({ key: t.key, category: choices[g.key] as Category, amount: t.amount, note: t.note, spent_on: t.date })),
      );
      const result = await onImport(items);
      const rules = loadRules();
      for (const g of toImport) rules[g.key] = choices[g.key] as Category;
      saveRules(rules);
      toast.success(
        result.skipped > 0
          ? `Zaimportowano ${result.created}, pominięto ${result.skipped} już istniejących`
          : `Zaimportowano ${result.created} wydatków`,
      );
      setStatement(null);
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się zaimportować wydatków"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Plik CSV z wyciągiem iPKO"
        data-testid="import-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
        <FileUpIcon /> Importuj z banku (CSV)
      </Button>

      <Dialog open={statement != null} onOpenChange={(open) => !open && setStatement(null)}>
        <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl" data-testid="import-dialog">
          <DialogHeader>
            <DialogTitle>Import wyciągu z iPKO</DialogTitle>
            <DialogDescription>
              Plik {fileName}: {statement?.transactions.length ?? 0} wydatków do przejrzenia
              {statement && statement.skippedIncome > 0 && `, pominięto ${statement.skippedIncome} wpływów`}
              {statement && statement.skippedForeign > 0 && `, ${statement.skippedForeign} transakcji w innej walucie`}. Przypisz kategorię
              każdemu sprzedawcy, a zapamiętamy ją na następny import.
            </DialogDescription>
          </DialogHeader>

          {unassigned > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={suggesting}
              onClick={suggestAll}
              className="w-fit"
            >
              <SparklesIcon className="size-4" />
              {suggesting ? "Analizuję..." : "Zaproponuj kategorie AI"}
            </Button>
          )}

          {pendingCount > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={includePending}
                onChange={(e) => setIncludePending(e.target.checked)}
                data-testid="import-pending"
              />
              <span>
                Uwzględnij transakcje w rozliczeniu (blokady): {pendingCount}
                <span className="block text-xs text-muted-foreground">
                  Po rozliczeniu pojawią się w kolejnym wyciągu. Jeśli mają ten sam tytuł i datę, nie zdublują się.
                </span>
              </span>
            </label>
          )}

          <ul className="grid gap-3" data-testid="import-groups">
            {groups.map((g) => (
              <li key={g.key} className="grid gap-2 rounded-xl border p-3" data-testid={`import-group-${g.key}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{g.key}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {g.items.length} {g.items.length === 1 ? "transakcja" : "transakcji"} · {money(g.total, currency)}
                  </span>
                </div>
                <div role="radiogroup" aria-label={`Kategoria: ${g.key}`} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {BUDGET_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={choices[g.key] === c}
                      onClick={() => setChoices((prev) => ({ ...prev, [g.key]: c }))}
                      className={cn(
                        "min-h-10 rounded-lg border px-2 text-sm font-medium transition-colors",
                        choices[g.key] === c ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {CATEGORY_INFO[c].label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={choices[g.key] === "SKIP"}
                    onClick={() => setChoices((prev) => ({ ...prev, [g.key]: "SKIP" }))}
                    className={cn(
                      "min-h-10 rounded-lg border px-2 text-sm font-medium transition-colors",
                      choices[g.key] === "SKIP" ? "border-foreground bg-muted" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Pomiń
                  </button>
                </div>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Pokaż transakcje</summary>
                  <ul className="mt-1 grid gap-0.5">
                    {g.items.map((t) => (
                      <li key={t.key} className="flex justify-between gap-2">
                        <span className="truncate">
                          {t.date} · {t.note}
                          {t.pending && " (w rozliczeniu)"}
                        </span>
                        <span className="tabular-nums">{money(t.amount, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            {groups.length === 0 && <li className="text-sm text-muted-foreground">Brak wydatków do zaimportowania.</li>}
          </ul>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span className="text-sm text-muted-foreground" data-testid="import-summary">
              {unassigned > 0
                ? `Do przypisania: ${unassigned} ${unassigned === 1 ? "sprzedawca" : "sprzedawców"}`
                : `Zaimportujemy ${importCount} wydatków na ${money(importTotal, currency)}`}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStatement(null)}>
                Anuluj
              </Button>
              <Button type="button" disabled={busy || unassigned > 0 || importCount === 0} onClick={submit} data-testid="import-submit">
                Importuj
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
