import type { BudgetPlan, Category, Expense } from "./api";
import { CATEGORY_INFO, money } from "./format";
import { totalsFor, periodOf } from "./ledger";
import { dateLabel, isoDate, nextInstallment, parseIso, remainingInstallments } from "./loans";

/**
 * Centrum alertów: te same reguły i kody co `GET /alerts` w API (backend/app/alerts.py).
 * Zalogowany dostaje listę z serwera, bez konta liczymy ją lokalnie z danych w przeglądarce.
 */

export type AlertLevel = "critical" | "warning" | "info";

export interface AppAlert {
  key: string;
  code: string;
  level: AlertLevel;
  /** odcisk stanu: ukryty alert wraca, gdy stan się zmieni (np. 80% -> 100%) */
  state: string;
  params: Record<string, unknown>;
  link: string;
}

export const USAGE_WARN_PERCENT = 80;
export const USAGE_CRITICAL_PERCENT = 100;
export const LOAN_DUE_DAYS = 3;

const LEVEL_ORDER: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
const CATEGORIES: Category[] = ["NEEDS", "FUTURE", "GOALS", "FUN"];

export const sortAlerts = (alerts: AppAlert[]) =>
  [...alerts].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.key.localeCompare(b.key));

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wpis rejestru z oznaczeniem pochodzenia (opłacona rata), jeśli je ma. */
type LedgerEntry = Expense & { source_type?: string | null; source_id?: string | null };

interface LocalInput {
  monthlyIncome: number | null;
  plan: BudgetPlan | null;
  ledger: LedgerEntry[];
  now?: Date;
}

/** Alerty bez konta: wykorzystanie kategorii, deficyt budżetu i zbliżające się raty. */
export function localAlerts({ monthlyIncome, plan, ledger, now = new Date() }: LocalInput): AppAlert[] {
  const out: AppAlert[] = [];
  const percentages = plan?.percentages ?? { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 };
  const loans = plan?.loans ?? [];
  const monthlyLoans = loans.filter((l) => remainingInstallments(l, now) > 0).reduce((s, l) => s + l.installment_amount, 0);
  const spent = totalsFor(ledger, periodOf(now));

  if (monthlyIncome && monthlyIncome > 0) {
    let total = monthlyLoans;
    for (const c of CATEGORIES) {
      const budget = round2((monthlyIncome * percentages[c]) / 100);
      const used = round2(spent[c] + (c === "NEEDS" ? monthlyLoans : 0));
      total += spent[c];
      if (budget <= 0) continue;
      const percent = Math.round((used / budget) * 1000) / 10;
      if (percent < USAGE_WARN_PERCENT) continue;
      const over = percent >= USAGE_CRITICAL_PERCENT;
      out.push({
        key: `CATEGORY_USAGE:${c}`,
        code: "CATEGORY_USAGE",
        level: over ? "critical" : "warning",
        state: over ? "100" : "80",
        params: { category: c, usage_percent: percent, budget, spent: used, available: round2(budget - used) },
        link: "/budget",
      });
    }
    if (total > monthlyIncome) {
      out.push({
        key: "BUDGET_DEFICIT",
        code: "BUDGET_DEFICIT",
        level: "critical",
        state: "deficit",
        params: { monthly_income: monthlyIncome, total_spent: round2(total), deficit: round2(total - monthlyIncome) },
        link: "/budget",
      });
    }
  }

  // rata w ciągu 3 dni, jeśli nie jest oznaczona jako opłacona w miesiącu terminu
  loans.forEach((loan) => {
    const next = loan.payment_day ? nextInstallment(loan, now) : null;
    if (!next || next.inDays > LOAN_DUE_DAYS) return;
    const due = isoDate(next.date);
    const key = `local:${loan.name}:${loan.installment_amount}`;
    const paid = ledger.some((e) => e.source_type === "LOAN" && e.source_id === key && e.spent_on.slice(0, 7) === due.slice(0, 7));
    if (paid) return;
    out.push({
      key: `LOAN_DUE:${key}`,
      code: "LOAN_DUE",
      level: next.inDays === 0 ? "critical" : "warning",
      state: due,
      params: { name: loan.name, amount: loan.installment_amount, due_date: due, days_left: next.inDays },
      link: "/expenses",
    });
  });
  return sortAlerts(out);
}

export interface AlertText {
  title: string;
  body: string;
}

const str = (v: unknown) => String(v ?? "");
const numOf = (v: unknown) => Number(v ?? 0);

/** Komunikat alertu po polsku; ten sam dla alertów z serwera i lokalnych. */
export function alertText(a: AppAlert, currency: string): AlertText {
  const p = a.params;
  switch (a.code) {
    case "CATEGORY_USAGE": {
      const label = CATEGORY_INFO[p.category as Category]?.label ?? str(p.category);
      const available = numOf(p.available);
      return {
        title: `${label}: ${numOf(p.usage_percent).toLocaleString("pl-PL")}% budżetu`,
        body:
          available > 0
            ? `Zostało ${money(available, currency)} z ${money(numOf(p.budget), currency)} w tym miesiącu.`
            : `Budżet kategorii wyczerpany${available < 0 ? ` (przekroczony o ${money(-available, currency)})` : ""}.`,
      };
    }
    case "BUDGET_DEFICIT":
      return {
        title: "Wydatki przekraczają dochód",
        body: `Wydatki i raty (${money(numOf(p.total_spent), currency)}) są wyższe od miesięcznego dochodu o ${money(numOf(p.deficit), currency)}.`,
      };
    case "LOAN_DUE": {
      const days = numOf(p.days_left);
      return {
        title: `Rata: ${str(p.name)} (${money(numOf(p.amount), currency)})`,
        body: days === 0 ? "Termin płatności jest dziś." : `Termin ${dateLabel(parseIso(str(p.due_date)))}, za ${days} ${days === 1 ? "dzień" : "dni"}.`,
      };
    }
    case "GOAL_OVERDUE":
      return {
        title: `Cel „${str(p.name)}” po terminie`,
        body: `Brakuje ${money(numOf(p.remaining), currency)}, termin był ${dateLabel(parseIso(str(p.target_date)))}.`,
      };
    case "GOAL_OFF_TRACK":
      return {
        title: `Cel „${str(p.name)}” nie zdąży na termin`,
        body: p.required_monthly ? `Potrzebna wpłata około ${money(numOf(p.required_monthly), currency)} miesięcznie.` : "Zwiększ miesięczną wpłatę lub przesuń termin.",
      };
    case "WISH_READY":
      return { title: `Czas na decyzję: ${str(p.name)}`, body: `Okres ostygnięcia minął. Cena ${money(numOf(p.price), currency)}.` };
    default:
      return { title: a.code, body: "" };
  }
}

// --- ukrywanie alertów bez konta ---------------------------------------------------------------

const DISMISSED_KEY = "wmt_alerts_dismissed";

export function readDismissed(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function writeDismissed(map: Record<string, string>) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
  } catch {}
}

export const visibleAlerts = (alerts: AppAlert[], dismissed: Record<string, string>) =>
  alerts.filter((a) => dismissed[a.key] !== a.state);
