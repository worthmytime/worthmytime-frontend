import { clean, merchantKeyOf, parseCsv, type ImportTx, type ParsedStatement } from "./ipko";

/**
 * Import uniwersalny: dowolna tabela z historią transakcji (CSV, TXT, XLSX) sprowadzana do stałej struktury wydatku.
 * Które kolumny są datą, kwotą i opisem, rozpoznaje Jev (`/api/map-columns`); tutaj jest odczyt tabeli, dopasowanie
 * awaryjne po nagłówkach i zawartości oraz zamiana wierszy na wydatki.
 */

export interface Table {
  header: string[];
  rows: string[][];
}

/** Pola wydatku, do których dopasowujemy kolumny pliku (numer kolumny albo null, gdy pliku jej brakuje). */
export interface FieldMapping {
  date: number | null;
  amount: number | null;
  description: number | null;
  currency: number | null;
  /** true: wydatki mają kwoty ujemne, a dodatnie to wpływy (pomijane); false: każdy wiersz z kwotą to wydatek */
  expensesNegative: boolean;
}

export type MappedField = "date" | "amount" | "description" | "currency";

const DELIMITERS = [";", ",", "\t", "|"];

/** Separator pól: ten, który daje najwięcej równych wierszy z co najmniej dwiema kolumnami. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 30);
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => parseCsv(l, d)[0]?.length ?? 0);
    const typical = [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    if (typical < 2) continue;
    const score = counts.filter((c) => c === typical).length * typical;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

export const rowsFromText = (text: string): string[][] => parseCsv(text, detectDelimiter(text)).map((r) => r.map((c) => c.trim()));

/**
 * Tabela z surowych wierszy: nagłówek to pierwszy wiersz o typowej dla pliku liczbie kolumn
 * (banki dopisują nad nim linie z numerem konta, okresem i saldem).
 */
export function toTable(rows: string[][]): Table | null {
  const filled = rows.map((r) => r.filter((c) => c !== "").length);
  const widest = Math.max(0, ...filled);
  if (widest < 2) return null;
  const headerAt = filled.findIndex((n) => n >= Math.max(2, Math.ceil(widest * 0.6)));
  if (headerAt < 0) return null;
  const width = Math.max(...rows.slice(headerAt).map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  const header = pad(rows[headerAt]).map((h, i) => clean(h) || `Kolumna ${i + 1}`);
  const body = rows.slice(headerAt + 1).map(pad);
  return body.length ? { header, rows: body } : null;
}

const valid = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Data z komórki jako YYYY-MM-DD: RRRR-MM-DD (także z godziną), DD.MM.RRRR, DD-MM-RRRR, DD/MM/RRRR, RRRR.MM.DD. */
export function parseDate(value: string): string | null {
  const s = value.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]) ? iso(+m[3], +m[2], +m[1]) : null;
  return null;
}

/** Kwota z komórki: "1 234,56 zł", "-1.234,56", "1,234.56 PLN", "(45,20)", "45,20-"; null, gdy to nie sama liczba. */
export function parseAmount(value: string): number | null {
  // waluta może stać przed kwotą albo po niej; inne litery oznaczają, że to tekst (np. "LIDL 123"), a nie kwota
  let s = value.replace(/[\s\u00a0\u202f]/g, "").replace(/^(?:[A-Za-z]{3}|zł|€|\$)|(?:[A-Za-z]{3}|zł|€|\$)$/gi, "");
  if (!/^[-\u2212+(]?\d[\d.,]*\)?[-\u2212]?$/.test(s)) return null;
  const negative = s.startsWith("(") || /^[-\u2212]/.test(s) || /[-\u2212]$/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (/[.,]$/.test(s)) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // oba znaki: ostatni jest separatorem dziesiętnym, drugi grupuje tysiące
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    // sam przecinek: dziesiętny, chyba że grupuje tysiące (1,234 albo 1,234,567)
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ""); // 1.234.567
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const column = (table: Table, i: number) => table.rows.map((r) => r[i] ?? "").filter((v) => v !== "");

/** Jaka część niepustych komórek kolumny daje się odczytać danym parserem. */
function share(table: Table, i: number, parse: (v: string) => unknown): number {
  const values = column(table, i);
  return values.length ? values.filter((v) => parse(v) != null).length / values.length : 0;
}

/** Czy kolumna nadaje się na dane pole (chroni przed błędnym dopasowaniem, także ze strony Jev). */
export function fits(table: Table, field: MappedField, i: number | null): boolean {
  if (i == null || i < 0 || i >= table.header.length) return false;
  if (field === "date") return share(table, i, parseDate) >= 0.6;
  if (field === "amount") return share(table, i, parseAmount) >= 0.6 && share(table, i, parseDate) < 0.6;
  if (field === "currency") return share(table, i, (v) => (/^[A-Za-z]{3}$/.test(v) ? v : null)) >= 0.8;
  return column(table, i).length > 0;
}

const HEADER_HINTS: Record<MappedField, RegExp> = {
  date: /data|date|dzie[nń]/i,
  amount: /kwota|amount|obci[aą][zż]|warto[sś][cć]|wydatek/i,
  description: /opis|tytu[lł]|odbiorc|kontrahent|sprzedaw|nazwa|szczeg[oó][lł]|description|merchant|title/i,
  currency: /walut|currency/i,
};
const NOT_AMOUNT = /saldo|balance|rachun|konto|numer|\bnr\b|id\b/i;

/** Dopasowanie awaryjne (bez Jev): nagłówki po słowach kluczowych, a przy ich braku zawartość kolumn. */
export function guessMapping(table: Table): FieldMapping {
  const indexes = table.header.map((_, i) => i);
  const pick = (field: MappedField, extra: (i: number) => boolean = () => true) => {
    const ok = indexes.filter((i) => fits(table, field, i) && extra(i));
    return ok.find((i) => HEADER_HINTS[field].test(table.header[i])) ?? null;
  };
  const date = pick("date") ?? indexes.find((i) => fits(table, "date", i)) ?? null;
  const amount =
    pick("amount", (i) => !NOT_AMOUNT.test(table.header[i])) ??
    indexes.find((i) => i !== date && fits(table, "amount", i) && !NOT_AMOUNT.test(table.header[i]) && column(table, i).some((v) => /[.,]\d{2}\b/.test(v))) ??
    null;
  const textual = indexes.filter((i) => i !== date && i !== amount && share(table, i, parseAmount) < 0.5 && share(table, i, parseDate) < 0.5);
  const longest = [...textual].sort((a, b) => column(table, b).join("").length - column(table, a).join("").length)[0];
  const description = textual.find((i) => HEADER_HINTS.description.test(table.header[i])) ?? longest ?? null;
  const currency = pick("currency");
  return withSign(table, { date, amount, description, currency, expensesNegative: true });
}

/** Znak kwot wynika z danych: gdy w kolumnie są liczby ujemne, to one są wydatkami; inaczej wydatkiem jest każdy wiersz. */
export function withSign(table: Table, mapping: FieldMapping): FieldMapping {
  const negative = mapping.amount != null && column(table, mapping.amount).some((v) => (parseAmount(v) ?? 0) < 0);
  return { ...mapping, expensesNegative: negative };
}

/** Propozycja Jev nałożona na dopasowanie awaryjne: pole z Jev wygrywa, jeśli jego kolumna faktycznie pasuje do danych. */
export function mergeMapping(table: Table, fallback: FieldMapping, suggested: Partial<Record<MappedField, number | null>>): FieldMapping {
  const merged = { ...fallback };
  for (const field of ["date", "amount", "description", "currency"] as const) {
    const i = suggested[field];
    if (i != null && fits(table, field, i)) merged[field] = i;
  }
  if (merged.description === merged.date || merged.description === merged.amount) merged.description = fallback.description;
  return withSign(table, merged);
}

/** Nagłówki i kilka przykładowych wartości dla Jev; długie ciągi cyfr (numery rachunków, kart) są maskowane. */
export function columnSamples(table: Table, count = 3): { index: number; header: string; samples: string[] }[] {
  return table.header.slice(0, 30).map((header, index) => ({
    index,
    header: header.slice(0, 60),
    samples: column(table, index)
      .slice(0, count)
      .map((v) => v.replace(/\d{8,}/g, "#").slice(0, 40)),
  }));
}

/** Krótki, stabilny skrót tekstu (klucz wiersza: ponowny import tego samego pliku nie dubluje wpisów). */
function hashKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `u${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/** Wiersze tabeli jako wydatki w stałej strukturze importu (data, kwota, opis, sprzedawca). */
export function buildStatement(table: Table, mapping: FieldMapping, baseCurrency = "PLN"): ParsedStatement {
  const transactions: ImportTx[] = [];
  const seen = new Map<string, number>();
  let skippedIncome = 0;
  let skippedForeign = 0;
  if (mapping.date == null || mapping.amount == null) return { transactions, skippedIncome, skippedForeign };

  for (const r of table.rows) {
    const date = parseDate(r[mapping.date] ?? "");
    const amount = parseAmount(r[mapping.amount] ?? "");
    if (!date || amount == null || amount === 0) continue;
    if (mapping.expensesNegative && amount > 0) {
      skippedIncome += 1;
      continue;
    }
    const currency = mapping.currency != null ? (r[mapping.currency] ?? "").trim().toUpperCase() : "";
    if (currency && currency !== baseCurrency.toUpperCase()) {
      skippedForeign += 1;
      continue;
    }
    const description = mapping.description != null ? clean(r[mapping.description] ?? "") : "";
    const merchant = description || "Nieznany sprzedawca";
    // identyczne wiersze w jednym pliku dostają kolejny numer, żeby się nie zlały w jeden wpis
    const base = `${date}|${amount}|${description}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    transactions.push({
      key: hashKey(n > 1 ? `${base}#${n}` : base),
      date,
      amount: Math.abs(amount),
      type: "",
      pending: false,
      note: merchant.slice(0, 200),
      merchant,
      merchantKey: merchantKeyOf(merchant),
    });
  }
  return { transactions, skippedIncome, skippedForeign };
}
