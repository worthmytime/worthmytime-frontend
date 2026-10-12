"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { money, num } from "@/lib/format";
import { applyServerErrors, DEFAULT_BUDGET, errorMessage, loansFromForm, loansSchema, loansToForm, parseNumber, type LoansFormIn, type LoansFormOut, numeric } from "@/lib/forms";
import { countsThisMonth, dateLabel, lastPaymentDate, nextInstallment, remainingInstallments, repaymentProgress } from "@/lib/loans";
import { useApp } from "./AppProvider";

const toIntOrNull = (s: string | undefined) => {
  if (!s || s.trim() === "") return null;
  const n = Math.floor(parseNumber(s));
  return Number.isFinite(n) ? n : null;
};

const toNumber = (s: string | undefined) => (s && s.trim() !== "" ? parseNumber(s) : 0) || 0;

interface Props {
  currency: string;
  /** miesięczny dochód netto: udział rat w dochodzie */
  income: number;
  /** stawka godzinowa: ile pracy kosztuje spłata */
  hourlyRate: number;
  /** po zapisie strona odświeża sumy (raty wchodzą do Potrzeb) */
  onSaved?: () => Promise<void> | void;
}

/**
 * Kredyty i pożyczki: raty to wydatek konieczny, więc karta jest na stronie Wydatki, a nie w podziale budżetu.
 * Zapis zmienia tylko kredyty; procenty kategorii zostają takie, jak są zapisane.
 */
export default function LoansCard(props: Props) {
  const { budget } = useApp();
  // po zapisie formularz startuje od nowa z zapisanych kredytów (nowe identyfikatory, wyczyszczony stan zmian)
  return <LoansForm key={JSON.stringify(budget?.loans ?? [])} {...props} />;
}

function LoansForm({ currency, income, hourlyRate, onSaved }: Props) {
  const { budget, saveBudget } = useApp();
  const form = useForm<LoansFormIn, unknown, LoansFormOut>({
    resolver: zodResolver(loansSchema),
    defaultValues: loansToForm(budget?.loans),
  });
  const {
    register,
    handleSubmit,
    setError,
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
    return { installment: toNumber(l?.installment_amount), left: remainingInstallments(loan), counts: countsThisMonth(loan), loan };
  });
  // budżet miesiąca obciąża każda rata wymagalna w tym miesiącu (także ostatnia, po terminie); spłacone wcześniej kredyty nie
  const monthlyLoans = loans.filter((x) => x.counts).reduce((s, l) => s + l.installment, 0);

  const savedForm = useMemo(() => JSON.stringify(loansToForm(budget?.loans)), [budget]);
  const dirty = JSON.stringify({ loans: w.loans ?? [] }) !== savedForm;

  async function submit(values: LoansFormOut) {
    try {
      // zmieniamy tylko kredyty: podział dochodu i przenoszenie środków zostają zapisane tak, jak były
      await saveBudget({ ...(budget ?? DEFAULT_BUDGET), loans: loansFromForm(values) });
      await onSaved?.();
      toast.success("Kredyty zapisane");
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(errorMessage(e, "Nie udało się zapisać kredytów"));
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Card data-testid="loans-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Kredyty i pożyczki
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">zobowiązania</span>
          </CardTitle>
          <CardDescription>
            Podaj ratę i dzień miesiąca, w którym ją płacisz, oraz okres spłaty (od - do) albo liczbę rat do spłacenia; suma kredytu jest opcjonalna. Raty to wydatek konieczny: liczymy je automatycznie do kategorii Potrzeby, więc zmniejszają dostępny budżet.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {fields.length === 0 && <p className="text-sm text-muted-foreground">Brak kredytów i pożyczek.</p>}
          {fields.map((f, i) => {
            const l = loans[i] ?? { installment: 0, left: 0, counts: false, loan: {} as (typeof loans)[number]["loan"] };
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
                    {(p) => <Input {...p} inputMode="decimal" placeholder="np. 800" className="h-11" {...numeric(register(`loans.${i}.installment_amount`))} />}
                  </Field>
                  <Field label="Dzień raty w miesiącu" hint="1-31, np. 15" error={errors.loans?.[i]?.payment_day?.message}>
                    {(p) => <Input {...p} inputMode="numeric" placeholder="np. 15" className="h-11" {...numeric(register(`loans.${i}.payment_day`))} />}
                  </Field>
                  <Field label="Suma kredytu" hint="Opcjonalnie, pierwotna kwota" error={errors.loans?.[i]?.loan_amount?.message} className="col-span-2 sm:col-span-1">
                    {(p) => <Input {...p} inputMode="decimal" placeholder="np. 40000" className="h-11" {...numeric(register(`loans.${i}.loan_amount`))} />}
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
                      placeholder={l.loan.end_date ? `wyliczone: ${l.left}` : "np. 36"}
                      className="h-11"
                      {...numeric(register(`loans.${i}.installments_left`))}
                    />
                  )}
                </Field>

                {l.loan.end_date && l.left === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid={`loan-summary-${i}`}>
                    {l.counts
                      ? "Ostatnia rata wypadła w tym miesiącu: liczymy ją jeszcze do budżetu tego miesiąca, od następnego już nie."
                      : "Okres spłaty już minął - ten kredyt uznajemy za spłacony i nie liczymy go do budżetu."}
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
          })}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() =>
                append({ loan_id: "", name: "", installment_amount: "", installments_left: "", loan_amount: "", start_date: "", end_date: "", payment_day: "" })
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="h-11 px-5" disabled={isSubmitting || !dirty}>
              {isSubmitting ? "Zapisuję…" : "Zapisz kredyty"}
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite" data-testid="loans-status">
              {dirty ? "Masz niezapisane zmiany w kredytach." : "Kredyty zapisane."}
            </span>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
