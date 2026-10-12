"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
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
import { dateLabel, lastPaymentDate, nextInstallment, remainingInstallments, repaymentProgress } from "@/lib/loans";
import { useLedger } from "@/lib/use-ledger";
import {
  applyServerErrors,
  BUDGET_CATEGORIES,
  budgetFromForm,
  budgetSchema,
  budgetToForm,
  errorMessage,
  type BudgetFormIn,
  type BudgetFormOut,
} from "@/lib/forms";

const toIntOrNull = (s: string | undefined) => {
  if (!s || s.trim() === "") return null;
  const n = Math.floor(Number(s.replace(",", ".")));
  return Number.isFinite(n) ? n : null;
};

const toNumber = (s: string | undefined) => (s && s.trim() !== "" ? Number(s.replace(",", ".")) : 0) || 0;

export default function BudgetPage() {
  const { ready, profile, monthlyIncome, budget, saveBudget } = useApp();
  const ledger = useLedger();
  if (!ready || ledger.loading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!profile || monthlyIncome == null) return <OnboardingCard />;
  const hoursPerMonth = (profile.hours_per_day * profile.days_per_week * 52) / 12;
  return (
    <BudgetForm
      key={JSON.stringify(budget)}
      income={monthlyIncome}
      hourlyRate={monthlyIncome / hoursPerMonth}
      currency={profile.currency}
      budget={budget}
      save={saveBudget}
      spent={ledger.totals}
    />
  );
}

function BudgetForm({
  income,
  hourlyRate,
  currency,
  budget,
  save,
  spent: spentByCategory,
}: {
  spent: Record<Category, number>;
  income: number;
  hourlyRate: number;
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
  const { fields, append, remove } = useFieldArray({ control, name: "loans" });
  const loans = (w.loans ?? []).map((l) => {
    const loan = {
      installments_left: toIntOrNull(l?.installments_left),
      start_date: l?.start_date || null,
      end_date: l?.end_date || null,
      payment_day: toIntOrNull(l?.payment_day),
    };
    return { installment: toNumber(l?.installment_amount), left: remainingInstallments(loan), loan };
  });
  // spłacone kredyty (0 pozostałych rat) nie obciążają budżetu
  const monthlyLoans = loans.filter((x) => x.left > 0).reduce((s, l) => s + l.installment, 0);
  const pct = (c: Category) => toNumber(w[`pct_${c}`]);
  const spent = (c: Category) => spentByCategory[c] ?? 0;
  const sum = BUDGET_CATEGORIES.reduce((s, c) => s + pct(c), 0);
  const totalSpent = BUDGET_CATEGORIES.reduce((s, c) => s + spent(c), 0) + monthlyLoans;
  const sumOk = Math.abs(sum - 100) < 0.01;

  async function submit(values: BudgetFormOut) {
    try {
      await save(budgetFromForm(values));
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
          liczymy z rejestru <Link href="/expenses" className="text-primary underline">Wydatki</Link> - tutaj ustawiasz tylko procenty i kredyty.
        </p>
      </div>

      <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
        {BUDGET_CATEGORIES.map((c) => {
          const info = CATEGORY_INFO[c];
          const amount = (income * pct(c)) / 100;
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
              </CardContent>
            </Card>
          );
        })}
        </div>

        <Card data-testid="loans-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Kredyty i pożyczki
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">P0 · zobowiązania</span>
            </CardTitle>
            <CardDescription>
              Podaj ratę i dzień miesiąca, w którym ją płacisz, oraz okres spłaty (od - do) albo liczbę rat do spłacenia; kwota kredytu jest opcjonalna. Raty liczymy automatycznie do kategorii Potrzeby, bo to wymagalne zobowiązania - zmniejszają dostępny budżet.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {fields.length === 0 && <p className="text-sm text-muted-foreground">Brak kredytów i pożyczek.</p>}
            {fields.map((f, i) => {
              const l = loans[i] ?? { installment: 0, left: 0, loan: {} as (typeof loans)[number]["loan"] };
              const remaining = l.installment * l.left;
              const next = l.left > 0 ? nextInstallment(l.loan) : null;
              const last = lastPaymentDate(l.loan);
              const progress = repaymentProgress(l.loan);
              return (
                <div key={f.id} className="grid gap-3 rounded-xl border bg-muted/30 p-3" data-testid={`loan-${i}`}>
                  <div className="flex items-end gap-2">
                    <Field label="Nazwa" className="flex-1" error={errors.loans?.[i]?.name?.message}>
                      {(p) => <Input {...p} placeholder="np. Kredyt hipoteczny" className="h-11" {...register(`loans.${i}.name`)} />}
                    </Field>
                    <Button type="button" variant="ghost" className="size-11" aria-label={`Usuń kredyt ${i + 1}`} onClick={() => remove(i)}>
                      <Trash2Icon />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Wysokość raty" error={errors.loans?.[i]?.installment_amount?.message}>
                      {(p) => <Input {...p} inputMode="decimal" placeholder="800" className="h-11" {...register(`loans.${i}.installment_amount`)} />}
                    </Field>
                    <Field label="Dzień raty w miesiącu" hint="1-31, np. 15" error={errors.loans?.[i]?.payment_day?.message}>
                      {(p) => <Input {...p} inputMode="numeric" placeholder="15" className="h-11" {...register(`loans.${i}.payment_day`)} />}
                    </Field>
                    <Field label="Kwota kredytu" hint="Opcjonalnie" error={errors.loans?.[i]?.loan_amount?.message} className="col-span-2 sm:col-span-1">
                      {(p) => <Input {...p} inputMode="decimal" placeholder="40000" className="h-11" {...register(`loans.${i}.loan_amount`)} />}
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Spłata od" error={errors.loans?.[i]?.start_date?.message}>
                      {(p) => <Input {...p} type="date" className="h-11" {...register(`loans.${i}.start_date`)} />}
                    </Field>
                    <Field label="Spłata do" error={errors.loans?.[i]?.end_date?.message}>
                      {(p) => <Input {...p} type="date" className="h-11" {...register(`loans.${i}.end_date`)} />}
                    </Field>
                  </div>
                  <Field
                    label="Rat do spłacenia"
                    hint={l.loan.end_date ? "Opcjonalnie - z daty końca liczymy ją sami i maleje z czasem" : "Podaj liczbę rat albo datę końca spłaty"}
                    error={errors.loans?.[i]?.installments_left?.message}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="numeric"
                        placeholder={l.loan.end_date ? `wyliczone: ${l.left}` : "36"}
                        className="h-11"
                        {...register(`loans.${i}.installments_left`)}
                      />
                    )}
                  </Field>

                  {l.loan.end_date && l.left === 0 && (
                    <p className="text-sm text-muted-foreground" data-testid={`loan-summary-${i}`}>
                      Okres spłaty już minął - ten kredyt uznajemy za spłacony i nie liczymy go do budżetu.
                    </p>
                  )}
                  {remaining > 0 && (
                    <div className="grid gap-2" data-testid={`loan-summary-${i}`}>
                      <p className="text-sm text-muted-foreground">
                        Do spłaty zostało <b className="text-foreground tabular-nums">{money(remaining, currency)}</b> ({l.left}{" "}
                        {l.left === 1 ? "rata" : "rat"}) - to <b className="text-foreground tabular-nums">{num(remaining / hourlyRate, 0)} h</b> Twojej
                        pracy. Rata to {num((l.installment / income) * 100, 1)}% dochodu.
                      </p>
                      {next && (
                        <p className="text-sm" data-testid={`loan-next-${i}`}>
                          Najbliższa rata: <b>{dateLabel(next.date)}</b> {next.inDays === 0 ? "(dziś)" : `(za ${next.inDays} ${next.inDays === 1 ? "dzień" : "dni"})`}
                          {last && (
                            <>
                              , ostatnia: <b>{dateLabel(last)}</b>
                            </>
                          )}
                          .
                        </p>
                      )}
                      {progress != null && (
                        <div className="grid gap-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Okres spłaty</span>
                            <span className="tabular-nums">{num(progress, 0)}%</span>
                          </div>
                          <div
                            className="h-1.5 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-label="Postęp okresu spłaty"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(progress)}
                          >
                            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() =>
                  append({ name: "", installment_amount: "", installments_left: "", loan_amount: "", start_date: "", end_date: "", payment_day: "" })
                }
              >
                <PlusIcon /> Dodaj kredyt lub pożyczkę
              </Button>
              {monthlyLoans > 0 && (
                <p className="text-sm" data-testid="loans-total">
                  Raty łącznie: <b className="tabular-nums">{money(monthlyLoans, currency)}</b> miesięcznie ({num((monthlyLoans / income) * 100, 1)}% dochodu)
                </p>
              )}
            </div>
          </CardContent>
        </Card>

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

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" className="h-11 px-6 text-base" disabled={isSubmitting}>
            {isSubmitting ? "Zapisuję…" : "Zapisz budżet"}
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => reset({ ...budgetToForm(null), loans: getValues("loans") })}>
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
