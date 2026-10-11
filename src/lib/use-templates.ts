"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { api, type ExpenseTemplate, type ExpenseTemplateIn } from "./api";
import { MAX_TEMPLATES } from "./templates";
import type { NewExpense } from "./use-ledger";

/** Szablony szybkich wydatków: konto -> API, anonimowo -> localStorage. Użycie szablonu dopisuje zwykły wpis do rejestru. */
export function useExpenseTemplates(addExpense: (e: NewExpense) => Promise<void>, reloadLedger: () => Promise<void>) {
  const { loggedIn, localTemplates, setLocalTemplates } = useApp();
  const [remote, setRemote] = useState<ExpenseTemplate[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api<{ items: ExpenseTemplate[] }>("/expense-templates")
      .then((r) => {
        if (!cancelled) setRemote(r.items);
      })
      .catch(() => {}); // szablony to tylko skrót: bez nich strona działa, więc nie pokazujemy błędu
    return () => {
      cancelled = true;
    };
  }, [loggedIn, version]);

  const items = loggedIn ? remote : localTemplates;

  const add = useCallback(
    async (t: ExpenseTemplateIn) => {
      if (loggedIn) {
        await api("/expense-templates", { body: t });
        setVersion((v) => v + 1);
      } else {
        if (localTemplates.length >= MAX_TEMPLATES) throw new Error(`Możesz mieć najwyżej ${MAX_TEMPLATES} szablonów: usuń któryś, żeby dodać nowy`);
        setLocalTemplates([...localTemplates, { ...t, id: crypto.randomUUID() }]);
      }
    },
    [loggedIn, localTemplates, setLocalTemplates],
  );

  const remove = useCallback(
    async (id: string) => {
      if (loggedIn) {
        await api(`/expense-templates/${id}`, { method: "DELETE" });
        setVersion((v) => v + 1);
      } else {
        setLocalTemplates(localTemplates.filter((x) => x.id !== id)); // dopisane już wpisy zostają
      }
    },
    [loggedIn, localTemplates, setLocalTemplates],
  );

  /** Dopisuje do rejestru wpis z dzisiejszą datą: kategoria i kwota z szablonu, nazwa jako notatka. */
  const apply = useCallback(
    async (t: ExpenseTemplate) => {
      if (loggedIn) {
        await api(`/expense-templates/${t.id}/use`, { body: {} });
        await reloadLedger();
      } else {
        await addExpense({ category: t.category, amount: t.amount, note: t.name });
      }
    },
    [loggedIn, addExpense, reloadLedger],
  );

  return { items, add, remove, apply };
}
