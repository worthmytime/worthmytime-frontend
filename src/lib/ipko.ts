import type { Category } from "./api";

/**
 * Import wyciągu z iPKO (CSV): parsowanie w przeglądarce, plik nie jest wysyłany na serwer.
 * Obsługujemy format: "Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji",...
 */

export interface ImportTx {
  /** stabilny klucz wiersza: ponowny import tego samego wyciągu nie dubluje wpisów */
  key: string;
  date: string; // YYYY-MM-DD
  amount: number; // dodatnia kwota wydatku
  type: string;
  /** transakcja jeszcze nierozliczona (blokada) */
  pending: boolean;
  note: string;
  /** nazwa do wyświetlenia (sprzedawca, odbiorca lub tytuł) */
  merchant: string;
  /** znormalizowany sprzedawca do grupowania i zapamiętywania kategorii */
  merchantKey: string;
}

/** Wydatek gotowy do zapisu (po przypisaniu kategorii). */
export interface ImportedExpense {
  key: string;
  category: Category;
  amount: number;
  note: string;
  spent_on: string;
}

export interface ParsedStatement {
  transactions: ImportTx[];
  skippedIncome: number;
  skippedForeign: number;
}

/** Odczyt tekstu z pliku: UTF-8, a gdy się nie da, windows-1250 (tak eksportuje iPKO). */
export function decodeStatement(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1250").decode(buffer);
  }
}

/** Minimalny parser CSV (cudzysłowy, podwojone cudzysłowy w polach, nowe linie w polach). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const label = (field: string) => field.split(":", 1)[0].trim();
const value = (field: string) => field.slice(field.indexOf(":") + 1).trim();

/** Wartość pola opisu o danej etykiecie (porównujemy początek, żeby nie zależeć od polskich znaków w nazwie). */
function describe(fields: string[], starts: string): string | undefined {
  const hit = fields.find((f) => label(f).toLowerCase().startsWith(starts.toLowerCase()));
  return hit ? value(hit) : undefined;
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\/+$/, "").trim();

/** Sklep z adresu transakcji kartą: "JMP S.A. BIEDRONKA 336 Miasto: LUBARTOW Kraj: POLSKA" -> nazwa i miasto. */
function placeFromLocation(location: string | undefined): { name?: string; city?: string } {
  if (!location) return {};
  const body = location.replace(/^Adres:\s*/i, "");
  const name = body.split(/\s+Miasto:|\s+Kraj:/)[0];
  const city = /Miasto:\s*(.*?)(?:\s+Kraj:|$)/.exec(body)?.[1];
  return { name: name ? clean(name) : undefined, city: city ? clean(city) : undefined };
}

/** Znormalizowany sprzedawca: bez numerów sklepów i kodów (BIEDRONKA 336 -> BIEDRONKA, ZABKA ZD721 K.1 -> ZABKA). */
export function merchantKeyOf(name: string): string {
  const tokens = name
    .toUpperCase()
    .split(/\s+/)
    .map((t) => {
      if (!/\d/.test(t)) return t;
      const letters = t.replace(/[^A-ZĄĆĘŁŃÓŚŹŻ]/g, "");
      return letters.length >= 4 ? letters : "";
    })
    .filter(Boolean);
  return clean(tokens.join(" ")) || clean(name.toUpperCase());
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

const number = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

export async function parseStatement(text: string): Promise<ParsedStatement> {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r[0]?.toLowerCase().includes("data operacji") && r[2]?.toLowerCase().includes("typ transakcji"));
  if (headerAt < 0) throw new Error("To nie wygląda na wyciąg z iPKO (brak nagłówka z kolumnami Data operacji i Typ transakcji).");

  const seen = new Map<string, number>();
  const transactions: ImportTx[] = [];
  let skippedIncome = 0;
  let skippedForeign = 0;

  for (const r of rows.slice(headerAt + 1)) {
    const amountRaw = (r[3] ?? "").trim();
    const amount = number(amountRaw);
    if (!amountRaw || !Number.isFinite(amount)) continue;
    if (amount >= 0) {
      skippedIncome += 1;
      continue;
    }
    if ((r[4] ?? "PLN").trim().toUpperCase() !== "PLN") {
      skippedForeign += 1;
      continue;
    }
    const date = (r[0]?.trim() || r[1]?.trim() || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const type = (r[2] ?? "").trim();
    const fields = r.slice(6).filter((f) => f.trim() !== "");
    const title = describe(fields, "Tytu") ?? "";
    const place = placeFromLocation(describe(fields, "Lokalizacja"));
    const recipient = describe(fields, "Nazwa odbiorcy");
    const merchant = clean(place.name || recipient || title || type) || "Nieznany sprzedawca";
    const note = (place.city && place.name ? `${merchant}, ${place.city}` : merchant).slice(0, 200);
    const pending = /blokada/i.test(type) || /rozliczeniu/i.test(r[5] ?? "");

    // identyczne wiersze w jednym pliku dostają kolejny numer, żeby się nie zlały w jeden wpis
    const base = `${date}|${amountRaw}|${title || merchant}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    transactions.push({
      key: await sha256Hex(n > 1 ? `${base}#${n}` : base),
      date,
      amount: Math.abs(amount),
      type,
      pending,
      note,
      merchant,
      merchantKey: merchantKeyOf(merchant),
    });
  }
  if (transactions.length === 0 && skippedIncome === 0 && skippedForeign === 0) throw new Error("W pliku nie znaleziono żadnych transakcji.");
  return { transactions, skippedIncome, skippedForeign };
}

// --- zapamiętane kategorie sprzedawców -----------------------------------------------------------

const RULES_KEY = "wmt_import_rules";

export function loadRules(): Record<string, Category> {
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Category>) : {};
  } catch {
    return {};
  }
}

export function saveRules(rules: Record<string, Category>) {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {}
}
