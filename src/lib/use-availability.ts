"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { api, type BudgetState, type Category } from "./api";
import { periodOf, totalsFor } from "./ledger";
import { countsThisMonth } from "./loans";

const DEFAULT_PERCENTAGES: Record<Category, number> = { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 };

/**
 * Ile wolnych środków zostało w tym miesiącu w każdej kategorii budżetu:
 * dochód × procent − wydane z rejestru (− raty kredytów w Potrzebach).
 * To jednocześnie maksimum, które można miesięcznie przeznaczyć na wydatek z danej kategorii.
 */
export function useCategoryAvailability(): Record<Category, number> | null {
  const { loggedIn, monthlyIncome, budget, localLedger } = useApp();
  const [remote, setRemote] = useState<Record<Category, number> | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api<BudgetState>("/budget")
      .then((b) => !cancelled && setRemote(b.available))
      .catch(() => !cancelled && setRemote(null));
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  if (loggedIn) return remote;
  if (monthlyIncome == null) return null;

  const pct = budget?.percentages ?? DEFAULT_PERCENTAGES;
  const spent = totalsFor(localLedger, periodOf());
  const loans = (budget?.loans ?? []).filter((l) => countsThisMonth(l)).reduce((s, l) => s + l.installment_amount, 0);
  const out = {} as Record<Category, number>;
  for (const c of Object.keys(DEFAULT_PERCENTAGES) as Category[]) {
    out[c] = Math.round(((monthlyIncome * pct[c]) / 100 - spent[c] - (c === "NEEDS" ? loans : 0)) * 100) / 100;
  }
  return out;
}