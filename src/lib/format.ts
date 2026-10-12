const nf = (max = 2) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: max, useGrouping: "always" });

export const num = (n: number, max = 2) => nf(max).format(n);
export const money = (n: number, currency = "PLN") =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 2, useGrouping: "always" }).format(n);

export const hm = (h: number, m: number) => (h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, "0")} min`);

export const FREQ_LABEL: Record<string, string> = {
  ONE_TIME: "jednorazowo",
  DAILY: "dziennie",
  WEEKLY: "tygodniowo",
  MONTHLY: "miesięcznie",
  YEARLY: "rocznie",
};

export const HORIZON_LABEL: Record<string, string> = {
  "1 month": "1 miesiąc",
  "1 year": "1 rok",
  "5 years": "5 lat",
  "10 years": "10 lat",
};

/** Polska odmiana rzeczownika po liczbie: 1 rok, 2-4 lata, 5+ lat; ułamki w dopełniaczu ("0,5 roku"). */
const plural = (n: number, one: string, few: string, many: string, fraction: string) => {
  if (!Number.isInteger(n)) return `${num(n)} ${fraction}`;
  const last = n % 10;
  const teen = n % 100 >= 12 && n % 100 <= 14;
  return `${n} ${n === 1 ? one : last >= 2 && last <= 4 && !teen ? few : many}`;
};

export const yearsLabel = (y: number) => plural(y, "rok", "lata", "lat", "roku");
export const monthsLabel = (m: number) => plural(m, "miesiąc", "miesiące", "miesięcy", "miesiąca");
// priority: kolejność ważności kategorii pokazywana w interfejsie (P1 = najważniejsza); API ma własne kody z modelu budżetu
export const CATEGORY_INFO = {
  NEEDS: { label: "Potrzeby", priority: "P1", hint: "mieszkanie, jedzenie, media, konieczny transport, leczenie, zobowiązania" },
  FUTURE: { label: "Przyszłość", priority: "P2", hint: "rezerwa, poduszka bezpieczeństwa, oszczędności, inwestycje, emerytura" },
  GOALS: { label: "Cele", priority: "P3", hint: "wakacje, samochód, elektronika, remont, większe zakupy" },
  FUN: { label: "Przyjemności", priority: "P4", hint: "rozrywka, restauracje, gry, dodatkowe subskrypcje, spontaniczne zakupy" },
} as const;