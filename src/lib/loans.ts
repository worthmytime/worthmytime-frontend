import type { LoanIn } from "./api";

/** Terminy spłat kredytów - te same reguły co na serwerze (backend/app/planning.py). */

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "YYYY-MM-DD" jako data lokalna o 12:00 (bez przesunięć strefy czasowej). */
export const parseIso = (s: string) => new Date(`${s}T12:00:00`);

const monthDate = (year: number, month0: number, day: number) => {
  const last = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(day, last), 12);
};

/** Dzień miesiąca przycięty do jego długości (termin 31. w lutym wypada 28./29.). */
export function addMonths(d: Date, months: number, day = d.getDate()): Date {
  const index = d.getFullYear() * 12 + d.getMonth() + months;
  return monthDate(Math.floor(index / 12), index % 12, day);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);

export function nextPaymentDate(today: Date, paymentDay: number): Date {
  const t = startOfDay(today);
  const thisMonth = monthDate(t.getFullYear(), t.getMonth(), paymentDay);
  return thisMonth >= t ? thisMonth : addMonths(t, 1, paymentDay);
}

type LoanDates = Pick<LoanIn, "installments_left" | "end_date" | "payment_day" | "start_date">;

/** Ile rat zostało; przy dacie końca spłaty liczba maleje sama z czasem. */
export function remainingInstallments(loan: LoanDates, today = new Date()): number {
  if (!loan.end_date) return loan.installments_left ?? 0;
  const end = parseIso(loan.end_date);
  const t = startOfDay(today);
  if (end < t) return 0;
  const day = loan.payment_day ?? end.getDate();
  let count = 0;
  for (let due = nextPaymentDate(t, day); due <= end; due = addMonths(due, 1, day)) count += 1;
  return count;
}

export function lastPaymentDate(loan: LoanDates, today = new Date()): Date | null {
  const left = remainingInstallments(loan, today);
  if (left <= 0) return null;
  if (loan.end_date) return parseIso(loan.end_date);
  const day = loan.payment_day ?? today.getDate();
  return addMonths(nextPaymentDate(today, day), left - 1, day);
}

export function nextInstallment(loan: LoanDates, today = new Date()): { date: Date; inDays: number } | null {
  if (remainingInstallments(loan, today) <= 0) return null;
  const day = loan.payment_day ?? (loan.end_date ? parseIso(loan.end_date).getDate() : today.getDate());
  const date = nextPaymentDate(today, day);
  return { date, inDays: Math.round((date.getTime() - startOfDay(today).getTime()) / 86_400_000) };
}

export interface Installment {
  date: Date;
  /** dni do terminu: 0 = dziś, ujemne = termin już minął */
  inDays: number;
}

/**
 * Raty kredytu do pokazania na stronie Wydatki: rata z bieżącego miesiąca przez cały miesiąc (także po terminie)
 * oraz kolejna, gdy termin bieżącej już minął, a następny wypada w ciągu `horizon` dni.
 */
export function installmentsToShow(loan: LoanDates, today = new Date(), horizon = 31): Installment[] {
  const t = startOfDay(today);
  const day = loan.payment_day ?? (loan.end_date ? parseIso(loan.end_date).getDate() : t.getDate());
  const thisMonth = monthDate(t.getFullYear(), t.getMonth(), day);
  const passed = thisMonth < t;
  const start = loan.start_date ? parseIso(loan.start_date) : null;
  const end = loan.end_date ? parseIso(loan.end_date) : null;
  const inDays = (date: Date) => Math.round((date.getTime() - t.getTime()) / 86_400_000);
  // rata mieści się w okresie spłaty; bez daty końca decyduje liczba rat pozostałych do spłacenia
  const inPeriod = (date: Date) => (!start || date >= start) && (!end || date <= end);
  const left = remainingInstallments(loan, today);

  const out: Installment[] = [];
  if (inPeriod(thisMonth) && (end ? true : (loan.installments_left ?? 0) >= 1)) out.push({ date: thisMonth, inDays: inDays(thisMonth) });
  if (passed) {
    const next = addMonths(thisMonth, 1, day);
    if (inPeriod(next) && left >= 1 && inDays(next) <= horizon) out.push({ date: next, inDays: inDays(next) });
  }
  return out;
}

/** Termin słownie: "dziś", "za 4 dni", "9 dni po terminie". */
export const dueText = (inDays: number) =>
  inDays === 0 ? "dziś" : inDays > 0 ? `za ${inDays} ${inDays === 1 ? "dzień" : "dni"}` : `${-inDays} ${inDays === -1 ? "dzień" : "dni"} po terminie`;

/** Jaka część okresu spłaty (od - do) już minęła, w procentach. */
export function repaymentProgress(loan: LoanDates, today = new Date()): number | null {
  if (!loan.start_date || !loan.end_date) return null;
  const start = parseIso(loan.start_date).getTime();
  const end = parseIso(loan.end_date).getTime();
  if (end <= start) return null;
  const now = Math.min(Math.max(startOfDay(today).getTime(), start), end);
  return Math.round(((now - start) / (end - start)) * 1000) / 10;
}

export const dateLabel = (d: Date) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
export const monthYearLabel = (d: Date) => d.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });