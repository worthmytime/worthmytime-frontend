import type { BudgetPlan, Category, Expense, MonthSummary } from "./api";

const CATEGORIES: Category[] = ["NEEDS", "FUTURE", "GOALS", "FUN"];

export const zeroTotals = (): Record<Category, number> => ({ NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 });

/** Miesiąc jako YYYY-MM (czas lokalny użytkownika). */
export const periodOf = (d: Date | string = new Date()): string => {
  if (typeof d === "string") return d.slice(0, 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const todayIso = (): string => {
  const d = new Date();
  return `${periodOf(d)}-${String(d.getDate()).padStart(2, "0")}`;
};

export const totalsFor = (items: Expense[], period: string): Record<Category, number> => {
  const totals = zeroTotals();
  // opłacona rata (LOAN) jest na liście, ale nie liczy się do "wydanego": rata jest już zobowiązaniem w Potrzebach
  for (const e of items) {
    if (e.source_type === "LOAN") continue;
    if (periodOf(e.spent_on) === period) totals[e.category] = round2(totals[e.category] + e.amount);
  }
  return totals;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ostatnie `count` miesięcy łącznie z bieżącym, rosnąco. */
export const lastPeriods = (count: number, from: Date = new Date()): string[] => {
  const out: string[] = [];
  let y = from.getFullYear();
  let m = from.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 1) [y, m] = [y - 1, 12];
    else m -= 1;
  }
  return out.reverse();
};

export const summarize = (items: Expense[], periods: string[]): MonthSummary[] =>
  periods.map((month) => {
    const totals = totalsFor(items, month);
    return { month, totals, total: round2(CATEGORIES.reduce((s, c) => s + totals[c], 0)) };
  });

// --- rejestr anonimowego użytkownika w przeglądarce -------------------------------------------

const LEDGER_KEY = "wmt_ledger";

export function readLocalLedger(): Expense[] {
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    return raw ? (JSON.parse(raw) as Expense[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalLedger(items: Expense[]) {
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(items));
  } catch {}
}

/**
 * Plan do wysłania w żądaniu bezstanowym (bez konta): "wydane" w kategoriach to wyłącznie suma rejestru
 * wydatków z bieżącego miesiąca - tak samo liczy je serwer dla zalogowanych.
 */
export function effectivePlan(plan: BudgetPlan, ledger: Expense[], now = new Date()): BudgetPlan {
  return { percentages: plan.percentages, spent: totalsFor(ledger, periodOf(now)), loans: plan.loans ?? [] };
}

/** Zdarzenie przeglądarki: zmieniły się wydatki albo budżet (słucha go kwota w pasku nawigacji). */
export const MONEY_CHANGED = "wmt:money-changed";

export function notifyMoneyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MONEY_CHANGED));
}
