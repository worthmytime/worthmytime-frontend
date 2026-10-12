"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { api, type BudgetState } from "./api";
import { MONEY_CHANGED, periodOf, totalsFor } from "./ledger";
import { countsThisMonth } from "./loans";

/**
 * Ile zostało w tym miesiącu: miesięczny dochód minus wydatki z rejestru i raty kredytów.
 * To nie jest saldo rachunku w banku (aplikacja go nie zna), tylko to, co zostało z dochodu tego miesiąca.
 * null, gdy nie ma profilu albo dane jeszcze się nie wczytały.
 */
export function useMonthBalance(): number | null {
  const { ready, loggedIn, monthlyIncome, budget, localLedger } = useApp();
  const pathname = usePathname();
  const [remote, setRemote] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    window.addEventListener(MONEY_CHANGED, onChange);
    return () => window.removeEventListener(MONEY_CHANGED, onChange);
  }, []);

  // konto: kwotę liczy API (ten sam plan co Budżet); odświeżamy przy zmianie strony i po każdej zmianie pieniędzy
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api<BudgetState>("/budget")
      .then((b) => {
        if (!cancelled) setRemote(b.monthly_income != null ? Math.round((b.monthly_income - b.total_spent) * 100) / 100 : null);
      })
      .catch(() => {}); // kwota w pasku to dodatek: bez niej aplikacja działa
    return () => {
      cancelled = true;
    };
  }, [loggedIn, pathname, version]);

  if (!ready) return null;
  if (loggedIn) return remote;
  if (monthlyIncome == null) return null;
  // bez konta: ta sama reguła na danych z przeglądarki
  const spent = Object.values(totalsFor(localLedger, periodOf())).reduce((s, v) => s + v, 0);
  const loans = (budget?.loans ?? []).filter((l) => countsThisMonth(l)).reduce((s, l) => s + l.installment_amount, 0);
  return Math.round((monthlyIncome - spent - loans) * 100) / 100;
}
