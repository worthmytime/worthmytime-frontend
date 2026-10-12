"use client";

import { FileUpIcon, SparklesIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Category } from "@/lib/api";
import { CATEGORY_INFO, money } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage } from "@/lib/forms";
import { suggestCategories, suggestMapping } from "@/lib/ai";
import { decodeStatement, ipkoHeaderAt, loadRules, parseCsv, parseStatement, saveRules, type ImportedExpense, type ImportTx, type ParsedStatement } from "@/lib/ipko";
import {
  buildStatement,
  columnSamples,
  guessMapping,
  mergeMapping,
  rowsFromText,
  toTable,
  withSign,
  type FieldMapping,
  type MappedField,
  type Table,
} from "@/lib/statement";
import { cn } from "@/lib/utils";
import { readXlsx } from "@/lib/xlsx";

type Choice = Category | "SKIP" | undefined;

interface Group {
  key: string;
  label: string;
  items: ImportTx[];
  total: number;
}

interface Props {
  currency: string;
  onImport: (items: ImportedExpense[], fileName?: string) => Promise<{ created: number; skipped: number; undoable?: boolean }>;
}

/** Wczytany plik: gotowy wyciąg iPKO albo dowolna tabela z dopasowaniem kolumn do pól wydatku. */
type Source =
  | { kind: "ipko"; statement: ParsedStatement }
  | { kind: "table"; table: Table; mapping: FieldMapping; mappedBy: "jev" | "auto" };

const FIELD_LABEL: Record<MappedField, string> = { date: "Data", amount: "Kwota", description: "Opis / sprzedawca", currency: "Waluta" };
const REQUIRED_FIELDS: MappedField[] = ["date", "amount"];

/**
 * Import historii transakcji z banku (CSV, TXT, XLSX): plik czytamy w przeglądarce, kolumny do pól wydatku dopasowuje Jev,
 * transakcje grupujemy po sprzedawcy, a kategorię proponuje Jev i zatwierdza użytkownik (kategorie są zapamiętywane).
 */
export default function ImportButton({ currency, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  // sprzedawcy, których kategorię zaproponował Jev, a użytkownik jeszcze jej nie potwierdził kliknięciem
  const [proposed, setProposed] = useState<string[]>([]);
  const [includePending, setIncludePending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const statement = useMemo<ParsedStatement | null>(() => {
    if (!source) return null;
    return source.kind === "ipko" ? source.statement : buildStatement(source.table, source.mapping, currency);
  }, [source, currency]);

  /** Tabela z pliku: XLSX czytamy jako arkusz, wszystko inne jako tekst z wykrytym separatorem. */
  async function readRows(file: File): Promise<{ rows: string[][]; text?: string }> {
    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer.slice(0, 2));
    // XLSX to archiwum ZIP (zaczyna się od "PK"), niezależnie od rozszerzenia w nazwie pliku
    if (head[0] === 0x50 && head[1] === 0x4b) return { rows: readXlsx(buffer) };
    const text = decodeStatement(buffer);
    return { rows: rowsFromText(text), text };
  }

  /** Kategorie od Jev dla sprzedawców bez kategorii; wybory użytkownika i zapamiętane reguły mają pierwszeństwo. */
  async function proposeCategories(merchants: { key: string; description: string }[], silent: boolean) {
    if (!merchants.length) return;
    setSuggesting(true);
    try {
      const suggestions = await suggestCategories(merchants);
      setChoices((prev) => ({ ...suggestions, ...prev }));
      setProposed((prev) => [...new Set([...prev, ...Object.keys(suggestions)])]);
    } catch (e) {
      if (!silent) toast.error(errorMessage(e, "Nie udało się zasugerować kategorii"));
    } finally {
      setSuggesting(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const { rows, text } = await readRows(file);
      let next: Source;
      // znany układ iPKO czytamy gotowym parserem (rozumie blokady i pola opisu); reszta idzie przez dopasowanie kolumn
      if (text != null && ipkoHeaderAt(parseCsv(text)) >= 0) {
        next = { kind: "ipko", statement: await parseStatement(text) };
      } else {
        const table = toTable(rows);
        if (!table) throw new Error("W pliku nie znaleziono tabeli z transakcjami.");
        const fallback = guessMapping(table);
        let mapping = fallback;
        let mappedBy: "jev" | "auto" = "auto";
        try {
          mapping = mergeMapping(table, fallback, await suggestMapping(columnSamples(table)));
          mappedBy = "jev";
        } catch {
          // Jev niedostępny: zostaje dopasowanie po nagłówkach i zawartości, które użytkownik może poprawić w oknie
        }
        if (mapping.date == null || mapping.amount == null) {
          throw new Error("Nie udało się rozpoznać w pliku kolumn z datą i kwotą. Sprawdź, czy to historia transakcji z banku.");
        }
        next = { kind: "table", table, mapping, mappedBy };
      }
      const parsed = next.kind === "ipko" ? next.statement : buildStatement(next.table, next.mapping, currency);
      const rules = loadRules();
      const initial: Record<string, Choice> = {};
      for (const t of parsed.transactions) if (rules[t.merchantKey]) initial[t.merchantKey] = rules[t.merchantKey];
      setChoices(initial);
      setProposed([]);
      setFileName(file.name);
      setSource(next);
      // kategorie dla nowych sprzedawców proponuje Jev od razu po wczytaniu; brak odpowiedzi niczego nie blokuje
      const unknown = new Map(parsed.transactions.filter((t) => !initial[t.merchantKey]).map((t) => [t.merchantKey, t.merchant]));
      void proposeCategories([...unknown].map(([key, description]) => ({ key, description })), true);
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się odczytać pliku"));
    } finally {
      if (fileRef.current) fileRef.current.value = ""; // pozwala wybrać ten sam plik jeszcze raz
    }
  }

  /** Ręczna poprawka dopasowania: użytkownik wskazuje inną kolumnę dla pola. */
  function remap(field: MappedField, value: string) {
    if (source?.kind !== "table") return;
    const index = value === "" ? null : Number(value);
    setSource({ ...source, mapping: withSign(source.table, { ...source.mapping, [field]: index }) });
  }

  function choose(key: string, choice: Choice) {
    setChoices((prev) => ({ ...prev, [key]: choice }));
    setProposed((prev) => prev.filter((k) => k !== key)); // kliknięcie potwierdza albo zmienia propozycję
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

  const suggestAll = () => proposeCategories(groups.filter((g) => !choices[g.key]).map((g) => ({ key: g.key, description: g.label })), false);

  async function submit() {
    setBusy(true);
    try {
      const items: ImportedExpense[] = toImport.flatMap((g) =>
        g.items.map((t) => ({ key: t.key, category: choices[g.key] as Category, amount: t.amount, note: t.note, spent_on: t.date })),
      );
      const result = await onImport(items, fileName);
      const rules = loadRules();
      for (const g of toImport) rules[g.key] = choices[g.key] as Category;
      saveRules(rules);
      toast.success(
        result.skipped > 0
          ? `Zaimportowano ${result.created}, pominięto ${result.skipped} już istniejących`
          : `Zaimportowano ${result.created} wydatków`,
        result.undoable ? { description: "Ten import możesz cofnąć w zakładce Zdarzenia." } : undefined,
      );
      setSource(null);
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
        accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Plik z historią transakcji (CSV, TXT, XLSX)"
        data-testid="import-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
        <FileUpIcon /> Importuj z banku
      </Button>

      <Dialog open={source != null} onOpenChange={(open) => !open && setSource(null)}>
        <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl" data-testid="import-dialog">
          <DialogHeader>
            <DialogTitle>{source?.kind === "ipko" ? "Import wyciągu z iPKO" : "Import historii transakcji"}</DialogTitle>
            <DialogDescription>
              Plik {fileName}: {statement?.transactions.length ?? 0} wydatków do przejrzenia
              {statement && statement.skippedIncome > 0 && `, pominięto ${statement.skippedIncome} wpływów`}
              {statement && statement.skippedForeign > 0 && `, ${statement.skippedForeign} transakcji w innej walucie`}. Przypisz kategorię
              każdemu sprzedawcy, a zapamiętamy ją na następny import.
            </DialogDescription>
          </DialogHeader>

          {source?.kind === "table" && (
            <fieldset className="grid gap-3 rounded-xl border p-3" data-testid="import-mapping">
              <legend className="px-1 text-sm font-medium">Rozpoznane kolumny</legend>
              <p className="text-xs text-muted-foreground" data-testid="import-mapped-by">
                {source.mappedBy === "jev"
                  ? "Kolumny dopasował Jev na podstawie nagłówków i kilku przykładowych wierszy. Sprawdź je i popraw, jeśli trzeba."
                  : "Jev nie odpowiedział, więc kolumny dopasowaliśmy po nagłówkach i zawartości. Sprawdź je i popraw, jeśli trzeba."}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(FIELD_LABEL) as MappedField[]).map((field) => (
                  <div key={field} className="grid gap-1.5">
                    {/* etykieta obok listy, a nie wokół niej: inaczej jej treścią byłyby też nazwy wszystkich kolumn */}
                    <label htmlFor={`import-map-${field}`} className="text-sm font-medium">
                      {FIELD_LABEL[field]}
                    </label>
                    <select
                      id={`import-map-${field}`}
                      className="h-11 rounded-lg border border-input bg-background px-2 text-sm"
                      value={source.mapping[field] ?? ""}
                      onChange={(e) => remap(field, e.target.value)}
                    >
                      {!REQUIRED_FIELDS.includes(field) && <option value="">brak w pliku</option>}
                      {REQUIRED_FIELDS.includes(field) && source.mapping[field] == null && <option value="">wybierz kolumnę</option>}
                      {source.table.header.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {source.mapping.expensesNegative
                  ? "Kwoty ujemne traktujemy jako wydatki, a dodatnie (wpływy) pomijamy."
                  : "W kolumnie kwot nie ma liczb ujemnych, więc każdy wiersz traktujemy jako wydatek."}
              </p>
            </fieldset>
          )}

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
              {suggesting ? "Jev analizuje..." : "Zaproponuj kategorie (Jev)"}
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
                  <span className="font-medium">
                    {g.key}
                    {proposed.includes(g.key) && choices[g.key] && (
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" data-testid="import-proposed">
                        propozycja Jev
                      </span>
                    )}
                  </span>
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
                      onClick={() => choose(g.key, c)}
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
                    onClick={() => choose(g.key, "SKIP")}
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
              <Button type="button" variant="outline" onClick={() => setSource(null)}>
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
