"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import { api, type BudgetState, type Category, type Expense, type MonthSummary } from "./api";
import { errorMessage } from "./forms";
import type { ImportedExpense } from "./ipko";
import { lastPeriods, periodOf, round2, summarize, todayIso, totalsFor, zeroTotals } from "./ledger";

const MONTHS = 6;

/** Klucz raty w rejestrze: id z serwera albo nazwa z kwotą raty (bez konta, żeby dwie raty o tej samej nazwie się nie myliły). */
export const loanKey = (loan: { id?: string; name: string; installment_amount?: number }) =>
  loan.id ?? `local:${loan.name}:${loan.installment_amount ?? ""}`;

export interface NewExpense {
  category: Category;
  amount: number;
  note?: string;
  spent_on?: string;
}

/** Rejestr wydatków: konto -> API, anonimowo -> localStorage. Zwraca bieżący miesiąc i trend ostatnich miesięcy. */
export function useLedger() {
  const { loggedIn, localLedger, setLocalLedger } = useApp();
  const [items, setItems] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<MonthSummary[]>([]);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0); // zmiana odświeża dane z API po dopisaniu lub usunięciu wpisu

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    Promise.all([
      api<{ items: Expense[] }>("/expenses"),
      api<{ months: MonthSummary[] }>(`/expenses/summary?months=${MONTHS}`),
      api<BudgetState>("/budget"),
    ])
      .then(([month, sum, b]) => {
        if (cancelled) return;
        setItems(month.items);
        setSummary(sum.months);
        setBudget(b);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(errorMessage(e, "Nie udało się pobrać wydatków"));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, version]);

  const loading = loggedIn && !loaded;
  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  const add = useCallback(
    async (e: NewExpense) => {
      if (loggedIn) {
        await api("/expenses", { body: e });
        await reload();
      } else {
        const item: Expense = {
          id: crypto.randomUUID(),
          category: e.category,
          amount: e.amount,
          note: e.note || null,
          spent_on: e.spent_on || todayIso(),
        };
        setLocalLedger([item, ...localLedger]);
      }
    },
    [loggedIn, reload, localLedger, setLocalLedger],
  );

  /** Edycja wpisu (kategoria, kwota, notatka, data); źródło wpisu (stały wydatek, import) zostaje. */
  const update = useCallback(
    async (id: string, e: NewExpense) => {
      if (loggedIn) {
        await api(`/expenses/${id}`, { method: "PUT", body: e });
        await reload();
      } else {
        setLocalLedger(
          localLedger.map((x) =>
            x.id === id ? { ...x, category: e.category, amount: e.amount, note: e.note || null, spent_on: e.spent_on || x.spent_on } : x,
          ),
        );
      }
    },
    [loggedIn, reload, localLedger, setLocalLedger],
  );

  const remove = useCallback(
    async (id: string) => {
      if (loggedIn) {
        await api(`/expenses/${id}`, { method: "DELETE" });
        await reload();
      } else {
        setLocalLedger(localLedger.filter((x) => x.id !== id));
      }
    },
    [loggedIn, reload, localLedger, setLocalLedger],
  );

  /** Rata kredytu jako opłacona: wpis w Potrzebach z oznaczeniem LOAN (nie liczy się drugi raz do "wydanego"). */
  const payLoan = useCallback(
    async (loan: { id?: string; name: string; installment_amount: number }, paidOn: string) => {
      if (loggedIn && loan.id) {
        await api(`/budget/loans/${loan.id}/pay`, { body: { paid_on: paidOn } });
        await reload();
      } else {
        const item: Expense = {
          id: crypto.randomUUID(),
          category: "NEEDS",
          amount: loan.installment_amount,
          note: `Rata: ${loan.name}`,
          spent_on: paidOn,
          source_type: "LOAN",
          source_id: loanKey(loan),
        };
        setLocalLedger([item, ...localLedger]);
      }
    },
    [loggedIn, reload, localLedger, setLocalLedger],
  );

  /** Import wielu wydatków (np. z wyciągu): ponowny import tych samych wierszy nie tworzy duplikatów. */
  const importMany = useCallback(
    async (list: ImportedExpense[]): Promise<{ created: number; skipped: number }> => {
      if (loggedIn) {
        let created = 0;
        let skipped = 0;
        for (let i = 0; i < list.length; i += 500) {
          const r = await api<{ created: number; skipped: number }>("/expenses/import", { body: { items: list.slice(i, i + 500) } });
          created += r.created;
          skipped += r.skipped;
        }
        await reload();
        return { created, skipped };
      }
      const have = new Set(localLedger.filter((e) => e.source_type === "IMPORT").map((e) => e.source_id));
      const fresh: Expense[] = [];
      for (const it of list) {
        if (have.has(it.key)) continue;
        have.add(it.key);
        fresh.push({ id: crypto.randomUUID(), category: it.category, amount: it.amount, note: it.note, spent_on: it.spent_on, source_type: "IMPORT", source_id: it.key });
      }
      if (fresh.length) setLocalLedger([...fresh, ...localLedger]);
      return { created: fresh.length, skipped: list.length - fresh.length };
    },
    [loggedIn, reload, localLedger, setLocalLedger],
  );

  const period = periodOf();
  const periods = lastPeriods(MONTHS);
  const monthItems = loggedIn
    ? items
    : localLedger.filter((x) => periodOf(x.spent_on) === period).sort((a, b) => b.spent_on.localeCompare(a.spent_on));
  const monthTotals = loggedIn ? totalsFor(items, period) : totalsFor(localLedger, period);
  const trend = loggedIn ? summary : summarize(localLedger, periods);
  const total = round2(Object.values(monthTotals).reduce((s, v) => s + v, 0));

  const allItems = loggedIn ? items : localLedger;
  return { loading, items: monthItems, allItems, totals: monthTotals ?? zeroTotals(), total, trend, serverBudget: budget, add, update, remove, payLoan, importMany, reload, period };
}