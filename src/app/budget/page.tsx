"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import DailyLimit from "@/components/DailyLimit";
import { Field } from "@/components/FormField";
import OnboardingCard from "@/components/OnboardingCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category } from "@/lib/api";
import { CATEGORY_INFO, money, num } from "@/lib/format";
import { countsThisMonth } from "@/lib/loans";
import { useLedger } from "@/lib/use-ledger";
import {
  applyServerErrors,
  BUDGET_CATEGORIES,
  budgetFromForm,
  budgetSchema,
  budgetToForm,
  errorMessage,
  loansForSave,
  parseNumber,
  type BudgetFormIn,
  type BudgetFormOut,
} from "@/lib/forms";

const toNumber = (s: string | undefined) => (s && s.trim() !== "" ? parseNumber(s) : 0) || 0;

export default function BudgetPage() {
  const { ready, profile, monthlyIncome, budget, saveBudget, loggedIn } = useApp();
  const ledger = useLedger();
  if (!ready || ledger.loading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!profile || monthlyIncome == null) return <OnboardingCard />;
  return (
    <BudgetForm
      key={JSON.stringify(budget)}
      income={monthlyIncome}
      currency={profile.currency}
      budget={budget}
      save={saveBudget}
      spent={ledger.totals}
      loggedIn={loggedIn}
      carried={ledger.serverBudget?.rollover_amounts}
      onSaved={ledger.reload}
    />
  );
}

function BudgetForm({
  income,
  currency,
  budget,
  save,
  spent: spentByCategory,
  loggedIn,
  carried,
  onSaved,
}: {
  spent: Record<Category, number>;
  loggedIn: boolean;
  /** środki przeniesione na bieżący miesiąc (z API; bez konta brak) */
  carried?: Record<Category, number>;
  onSaved: () => Promise<void>;
  income: number;
  currency: string;
  budget: ReturnType<typeof useApp>["budget"];
  save: ReturnType<typeof useApp>["saveBudget"];
}) {
  const form = useForm<BudgetFormIn, unknown, BudgetFormOut>({
    resolver: zodResolver(budgetSchema),
    defaultValues: budgetToForm(budget),
  });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = form;
  const w = useWatch({ control });
  // raty obciążające ten miesiąc: z zapisanych kredytów (zarządza się nimi na stronie Wydatki)
  const monthlyLoans = (budget?.loans ?? []).filter((l) => countsThisMonth(l)).reduce((total, l) => total + l.installment_amount, 0);
  const pct = (c: Category) => toNumber(w[`pct_${c}`]);
  const spent = (c: Category) => spentByCategory[c] ?? 0;
  const sum = BUDGET_CATEGORIES.reduce((s, c) => s + pct(c), 0);
  const totalSpent = BUDGET_CATEGORIES.reduce((s, c) => s + spent(c), 0) + monthlyLoans;
  const sumOk = Math.abs(sum - 100) < 0.01;

  // niezapisane zmiany: bieżąca zawartość formularza różni się od zapisanego planu
  const savedForm = useMemo(() => JSON.stringify(budgetToForm(budget)), [budget]);
  const dirty = JSON.stringify(w) !== savedForm;

  // przejście na inną stronę (menu, linki) z niezapisanymi zmianami wymaga potwierdzenia
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      if (!window.confirm("Masz niezapisane zmiany w budżecie. Wyjść bez zapisywania?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  async function submit(values: BudgetFormOut) {
    try {
      // zapisujemy sam podział dochodu; kredyty przechodzą bez zmian, z identyfikatorami
      await save({ ...budgetFromForm(values, loggedIn), loans: loansForSave(budget?.loans) });
      await onSaved(); // przeniesione kwoty liczy serwer, więc po zmianie ustawienia pobieramy je ponownie
      toast.success("Budżet zapisany");
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(errorMessage(e, "Nie udało się zapisać budżetu"));
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan budżetu</h1>
        <p className="text-sm text-muted-foreground">
          Podziel miesięczny dochód ({money(income, currency)}) na koszyki. Przy każdym zakupie sprawdzimy, czy mieści się w budżecie wybranej kategorii. Wydane w kategoriach
          liczymy z rejestru <Link href="/expenses" className="text-primary underline">Wydatki</Link>, tam też są kredyty i pożyczki - tutaj ustawiasz tylko podział dochodu.
        </p>
      </div>

      <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
        {BUDGET_CATEGORIES.map((c) => {
          const info = CATEGORY_INFO[c];
          const rollover = !!w[`rollover_${c}`];
          // przeniesiona kwota obowiązuje tylko przy włączonej opcji (po wyłączeniu znika od razu, jeszcze przed zapisem)
          const carry = rollover ? (carried?.[c] ?? 0) : 0;
          const amount = (income * pct(c)) / 100 + carry;
          const loansHere = c === "NEEDS" ? monthlyLoans : 0;
          const available = amount - spent(c) - loansHere;
          return (
            <Card key={c} data-testid={`budget-${c}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {info.label}
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{info.priority}</span>
                </CardTitle>
                <CardDescription>{info.hint}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field label="Udział w dochodzie (%)" error={errors[`pct_${c}`]?.message}>
                  {(p) => <Input {...p} inputMode="decimal" className="h-11 sm:max-w-40" {...register(`pct_${c}`)} />}
                </Field>
                <p className="text-sm text-muted-foreground">
                  Budżet: <b className="text-foreground tabular-nums">{money(amount, currency)}</b> · wydane (rejestr
                  {loansHere > 0 ? " + raty" : ""}): <b className="text-foreground tabular-nums">{money(spent(c) + loansHere, currency)}</b> · dostępne:{" "}
                  <b className={available < 0 ? "text-destructive tabular-nums" : "text-foreground tabular-nums"}>{money(available, currency)}</b>
                </p>
                <DailyLimit budget={amount} variableSpent={spent(c)} fixed={loansHere} currency={currency} testId={`daily-${c}`} />
                {loansHere > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="loans-total">
                    W tym raty kredytów i pożyczek: {money(loansHere, currency)} miesięcznie ({num((loansHere / income) * 100, 1)}% dochodu). Kredytami
                    zarządzasz na stronie{" "}
                    <Link href="/expenses" className="text-primary underline">
                      Wydatki
                    </Link>
                    .
                  </p>
                )}
                {loggedIn ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" role="switch" className="mt-0.5 size-5 shrink-0" {...register(`rollover_${c}`)} />
                    <span>
                      Przenoś niewykorzystane środki na kolejny miesiąc
                      <span className="block text-xs text-muted-foreground" data-testid={`rollover-info-${c}`}>
                        {!rollover
                          ? "Wyłączone: każdy miesiąc zaczyna się od samego budżetu kategorii."
                          : carry > 0
                            ? `W tym miesiącu przeniesiono ${money(carry, currency)} (wliczone w budżet powyżej).`
                            : "W tym miesiącu nic nie przeniesiono. To, czego nie wydasz, przejdzie na następny miesiąc (najwyżej jeden miesięczny budżet)."}
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-muted-foreground" data-testid={`rollover-info-${c}`}>
                    Przenoszenie niewykorzystanych środków na kolejny miesiąc jest dostępne po zalogowaniu.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        </div>

        <Card size="sm" className={sumOk ? "" : "ring-destructive/50"}>
          <CardContent className="grid gap-1 text-sm">
            <p aria-live="polite">
              Suma procentów:{" "}
              <b data-testid="pct-sum" className={sumOk ? "text-foreground" : "text-destructive"}>
                {num(sum, 2)}%
              </b>{" "}
              {!sumOk && <span className="text-destructive">- powinno być 100%</span>}
            </p>
            <p className="text-muted-foreground">
              Wydane łącznie: {money(totalSpent, currency)}
              {totalSpent > income && <span className="text-destructive"> - więcej niż dochód ({money(totalSpent - income, currency)} deficytu)</span>}
            </p>
          </CardContent>
        </Card>

        {/* pasek zapisu zawsze widoczny u dołu ekranu (nad dolną nawigacją na telefonie), żeby nie trzeba było przewijać całej strony */}
        <div
          className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur lg:bottom-4"
          data-testid="budget-save-bar"
        >
          <p className="min-w-0 flex-1 basis-40 px-1 text-sm" aria-live="polite" data-testid="budget-status">
            {!sumOk ? (
              <span className="font-medium text-destructive">Suma procentów: {num(sum, 2)}%, powinno być 100%.</span>
            ) : dirty ? (
              <span className="font-medium">Masz niezapisane zmiany.</span>
            ) : (
              <span className="text-muted-foreground">Wszystkie zmiany zapisane.</span>
            )}
          </p>
          <Button type="submit" size="lg" className="h-11 px-6 text-base" disabled={isSubmitting}>
            {isSubmitting ? "Zapisuję…" : "Zapisz budżet"}
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => {
              // wracają tylko procenty: przenoszenie środków zostaje
              const v = getValues();
              reset({
                ...budgetToForm(null),
                rollover_NEEDS: v.rollover_NEEDS,
                rollover_FUTURE: v.rollover_FUTURE,
                rollover_GOALS: v.rollover_GOALS,
                rollover_FUN: v.rollover_FUN,
              });
            }}>
            Przywróć 50/25/15/10
          </Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        Podział 50/25/15/10 to tylko punkt startowy, a nie uniwersalna reguła finansowa - dostosuj go do własnej sytuacji. Wyniki wynikają z Twoich założeń i nie są poradą finansową.
      </p>
    </div>
  );
}
