"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon, ChevronRightIcon, PencilIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/AppProvider";
import DailyLimit from "@/components/DailyLimit";
import ExpenseEditForm from "@/components/ExpenseEditForm";
import ImportButton from "@/components/ImportButton";
import { Field } from "@/components/FormField";
import OnboardingCard from "@/components/OnboardingCard";
import PlannedRecurringList from "@/components/PlannedRecurringList";
import RecurringCard from "@/components/RecurringCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category } from "@/lib/api";
import { CATEGORY_INFO, money, num } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage } from "@/lib/forms";
import { suggestCategory } from "@/lib/ai";
import { todayIso } from "@/lib/ledger";
import { dateLabel, isoDate, nextInstallment } from "@/lib/loans";
import { plannedFor } from "@/lib/recurring";
import { loanKey, useLedger } from "@/lib/use-ledger";
import { useRecurring } from "@/lib/use-recurring";
import { cn } from "@/lib/utils";

const schema = z.object({
  amount: z
    .string()
    .transform((s) => Number(s.replace(",", ".")))
    .refine((n) => Number.isFinite(n) && n > 0, "Podaj kwotę większą od zera"),
  note: z.string().trim().max(200),
  spent_on: z.string().min(1, "Podaj datę"),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const COLORS: Record<Category, string> = {
  NEEDS: "var(--chart-1)",
  FUTURE: "var(--chart-2)",
  GOALS: "var(--chart-3)",
  FUN: "var(--chart-5)",
};

const entriesLabel = (n: number) =>
  n === 1 ? "1 wpis" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? `${n} wpisy` : `${n} wpisów`;

const installmentsLabel = (n: number) => (n === 1 ? "1 rata" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? `${n} raty` : `${n} rat`);

const plannedLabel = (n: number) =>
  n === 1 ? "1 zaplanowany" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? `${n} zaplanowane` : `${n} zaplanowanych`;

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("pl-PL", { month: "short", year: "2-digit" });

export default function ExpensesPage() {
  const { ready, profile, monthlyIncome, budget, loggedIn } = useApp();
  const ledger = useLedger();
  const recurring = useRecurring(ledger.reload);
  const [category, setCategory] = useState<Category>("FUN");
  const [suggesting, setSuggesting] = useState(false);
  // które kategorie w podsumowaniu miesiąca są rozwinięte (pokazują swoje wpisy)
  const [open, setOpen] = useState<Partial<Record<Category, boolean>>>({});
  const [editing, setEditing] = useState<string | null>(null); // id wpisu, który jest teraz edytowany
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: { amount: "", note: "", spent_on: todayIso() },
  });
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = form;

  if (!ready || ledger.loading || recurring.loading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!profile || monthlyIncome == null) return <OnboardingCard />;

  const currency = profile.currency;
  const loansTotal = (budget?.loans ?? []).reduce((s, l) => s + l.installment_amount, 0);
  const percentages = budget?.percentages ?? { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 };
  // najbliższe raty kredytów (w ciągu 31 dni), od najwcześniejszej
  const upcoming = (budget?.loans ?? [])
    .map((l) => ({ loan: l, next: nextInstallment(l) }))
    .filter((x): x is { loan: (typeof x)["loan"]; next: NonNullable<(typeof x)["next"]> } => x.next != null && x.next.inDays <= 31)
    .sort((a, b) => a.next.date.getTime() - b.next.date.getTime())

  // budżet, wydane (ręcznie + rejestr + raty w Potrzebach) per kategoria
  const rows = BUDGET_CATEGORIES.map((c) => {
    const amount = ledger.serverBudget?.amounts?.[c] ?? (monthlyIncome * percentages[c]) / 100;
    const loans = c === "NEEDS" ? loansTotal : 0;
    const spent = ledger.totals[c] + loans;
    return { c, amount, spent, usage: amount > 0 ? (spent / amount) * 100 : null, fromLedger: ledger.totals[c], fixed: loans };
  });

  // rata opłacona = wpis LOAN w miesiącu jej terminu
  const isPaid = (loan: { id?: string; name: string; installment_amount: number }, due: Date) =>
    ledger.allItems.some((e) => e.source_type === "LOAN" && e.source_id === loanKey(loan) && e.spent_on.slice(0, 7) === isoDate(due).slice(0, 7));

  // nieopłacone raty pokazujemy też w drzewie, pod Potrzebami (opłacone są już na liście jako wpisy "rata")
  const dueLoans = upcoming.filter(({ loan, next }) => !isPaid(loan, next.date));

  const selected = rows.find((r) => r.c === category);

  async function suggestExpenseCategory() {
    const note = getValues("note").trim();
    if (!note) return;
    setSuggesting(true);
    try {
      const suggestion = await suggestCategory(note);
      if (suggestion) setCategory(suggestion);
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się zasugerować kategorii"));
    } finally {
      setSuggesting(false);
    }
  }

  async function submit(v: FormOut) {
    try {
      await ledger.add({ category, amount: v.amount, note: v.note || undefined, spent_on: v.spent_on });
      toast.success("Wydatek dopisany");
      setOpen((o) => ({ ...o, [category]: true })); // od razu pokaż dopisany wpis w jego kategorii
      reset({ amount: "", note: "", spent_on: todayIso() });
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się dopisać wydatku"));
    }
  }

  const config = Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, { label: CATEGORY_INFO[c].label, color: COLORS[c] }])) satisfies ChartConfig;
  const chart = ledger.trend.map((m) => ({ month: monthLabel(m.month), ...m.totals }));

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wydatki</h1>
          <p className="text-sm text-muted-foreground">
            Dopisuj wydatki na bieżąco - dostępny budżet kategorii w kalkulatorze uwzględni je automatycznie.
            {!loggedIn && " Bez konta zapisujemy je tylko w tej przeglądarce."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <ImportButton currency={currency} onImport={ledger.importMany} />
          <span className="text-xs text-muted-foreground">Obsługiwany format: wyciąg z iPKO (CSV)</span>
        </div>
      </div>

      {/* komputer: dwie kolumny (dodawanie po lewej, podsumowanie i wpisy po prawej); telefon: jedna kolumna w kolejności order */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="contents lg:grid lg:content-start lg:gap-6">
          <div className="order-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dopisz wydatek</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
                <div role="radiogroup" aria-label="Kategoria wydatku" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BUDGET_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={category === c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        "min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors",
                        category === c ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {CATEGORY_INFO[c].label}
                    </button>
                  ))}
                </div>
                {selected && (
                  <DailyLimit
                    budget={selected.amount}
                    variableSpent={selected.fromLedger}
                    fixed={selected.fixed}
                    currency={currency}
                    testId="form-daily-limit"
                    spentToday={ledger.items.filter((e) => e.category === category && e.spent_on === todayIso()).reduce((s, e) => s + e.amount, 0)}
                  />
                )}
                <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
                  <Field label="Kwota" error={errors.amount?.message}>
                    {(p) => <Input {...p} inputMode="decimal" placeholder="49,90" className="h-11" {...register("amount")} />}
                  </Field>
                  <Field label="Data" error={errors.spent_on?.message}>
                    {(p) => <Input {...p} type="date" className="h-11" {...register("spent_on")} />}
                  </Field>
                </div>
                <Field label="Notatka (opcjonalnie)" error={errors.note?.message}>
                  {(p) => <Input {...p} placeholder="np. kino" className="h-11" {...register("note")} />}
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={suggesting}
                  onClick={suggestExpenseCategory}
                  className="w-fit"
                >
                  <SparklesIcon className="size-4" />
                  {suggesting ? "Analizuję..." : "Zaproponuj kategorię AI"}
                </Button>
                <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
                  Dopisz wydatek
                </Button>
              </form>
            </CardContent>
          </Card>

          </div>
          <div className="order-3">
          {upcoming.length > 0 && (
            <Card size="sm" data-testid="upcoming-installments">
              <CardHeader>
                <CardTitle className="text-base">Zbliżające się raty</CardTitle>
                <CardDescription>Raty kredytów i pożyczek w najbliższych tygodniach (liczą się do Potrzeb)</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {upcoming.map(({ loan, next }, i) => (
                    <li key={`${loan.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{loan.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {dateLabel(next.date)} · {next.inDays === 0 ? "dziś" : `za ${next.inDays} ${next.inDays === 1 ? "dzień" : "dni"}`}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold">{money(loan.installment_amount, currency)}</span>
                      {isPaid(loan, next.date) ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary" data-testid={`paid-${i}`}>
                          <CheckIcon className="size-3.5" aria-hidden /> Opłacona
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          aria-label={`Oznacz ratę ${loan.name} jako zapłaconą`}
                          onClick={() => ledger.payLoan(loan, isoDate(next.date)).then(() => toast.success("Rata oznaczona jako zapłacona")).catch((err) => toast.error(errorMessage(err)))}
                        >
                          Zapłacona
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          </div>
          <div className="order-4">
          <RecurringCard recurring={recurring} currency={currency} />

          </div>
        </div>
        <div className="contents lg:grid lg:content-start lg:gap-6">
          <div className="order-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ten miesiąc</CardTitle>
                <CardDescription>
                  Wydane łącznie z rejestru: {money(ledger.total, currency)}. Rozwiń kategorię, żeby zobaczyć jej wpisy.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                {rows.map((r) => {
                  const entries = ledger.items.filter((e) => e.category === r.c);
                  const loanRows = r.c === "NEEDS" ? dueLoans : [];
                  const planned = plannedFor(recurring.items, ledger.items, r.c); // stałe wydatki czekające na termin w tym miesiącu
                  const isOpen = !!open[r.c];
                  return (
                    <div key={r.c} className="grid min-w-0 gap-1.5" data-testid={`usage-${r.c}`}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`entries-${r.c}`}
                        onClick={() => setOpen((o) => ({ ...o, [r.c]: !o[r.c] }))}
                        className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-md py-0.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 font-medium">
                          <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} aria-hidden />
                          {CATEGORY_INFO[r.c].label}
                          <span className="text-xs font-normal text-muted-foreground">
                            ({entriesLabel(entries.length)}
                            {loanRows.length > 0 && `, ${installmentsLabel(loanRows.length)} do zapłaty`}
                            {planned.length > 0 && `, ${plannedLabel(planned.length)}`})
                          </span>
                        </span>
                        <span className={cn("shrink-0 tabular-nums text-muted-foreground", r.usage != null && r.usage > 100 && "text-destructive")}>
                          {money(r.spent, currency)} / {money(r.amount, currency)}
                          {r.usage != null && ` (${num(r.usage, 0)}%)`}
                        </span>
                      </button>
                      <div
                        role="progressbar"
                        aria-label={`Wykorzystanie budżetu: ${CATEGORY_INFO[r.c].label}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(100, Math.round(r.usage ?? 0))}
                        className="h-2 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className={cn("h-full rounded-full", r.usage != null && r.usage > 100 ? "bg-destructive" : "bg-primary")}
                          style={{ width: `${Math.min(100, r.usage ?? 0)}%` }}
                        />
                      </div>
                      <DailyLimit budget={r.amount} variableSpent={r.fromLedger} fixed={r.fixed} currency={currency} testId={`daily-${r.c}`} />
                      {isOpen && (
                        <div id={`entries-${r.c}`} className="mt-1 ml-2 min-w-0 border-l pl-3">
                          {loanRows.length > 0 && (
                            <ul className="divide-y border-b" data-testid={`loan-rows-${r.c}`} aria-label="Raty do zapłaty">
                              {loanRows.map(({ loan, next }, i) => (
                                <li key={`${loan.name}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                                  <div className="min-w-0 flex-1 basis-44">
                                    <p className="truncate text-sm font-medium">
                                      {loan.name}
                                      <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400" data-testid="loan-row-status">
                                        rata do zapłaty
                                      </span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {dateLabel(next.date)} · {next.inDays === 0 ? "dziś" : `za ${next.inDays} ${next.inDays === 1 ? "dzień" : "dni"}`}
                                    </p>
                                  </div>
                                  <span className="tabular-nums text-sm font-semibold">{money(loan.installment_amount, currency)}</span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={`Zapłacona: rata ${loan.name}`}
                                    onClick={() =>
                                      ledger
                                        .payLoan(loan, isoDate(next.date))
                                        .then(() => toast.success("Rata oznaczona jako zapłacona"))
                                        .catch((err) => toast.error(errorMessage(err)))
                                    }
                                  >
                                    Zapłacona
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <PlannedRecurringList planned={planned} category={r.c} currency={currency} />
                          {entries.length === 0 && loanRows.length === 0 && planned.length === 0 ? (
                            <p className="py-1 text-sm text-muted-foreground">Brak wpisów w tej kategorii.</p>
                          ) : entries.length === 0 ? null : (
                            <ul className="divide-y" data-testid={`expense-list-${r.c}`}>
                              {entries.map((e) => (
                                <li key={e.id} className="flex items-center gap-2 py-1.5">
                                  {editing === e.id ? (
                                    <ExpenseEditForm
                                      entry={e}
                                      onCancel={() => setEditing(null)}
                                      onSave={async (v) => {
                                        await ledger.update(e.id, v);
                                        setEditing(null);
                                        toast.success("Wydatek zapisany");
                                      }}
                                    />
                                  ) : (
                                  <>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">
                                      {e.note || CATEGORY_INFO[e.category].label}
                                      {e.source_type && (
                                        <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" data-testid="expense-source">
                                          {e.source_type === "LOAN" ? "rata" : e.source_type === "IMPORT" ? "import" : "stały"}
                                        </span>
                                      )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{new Date(`${e.spent_on}T12:00:00`).toLocaleDateString("pl-PL")}</p>
                                  </div>
                                  <span className="tabular-nums text-sm font-semibold">{money(e.amount, currency)}</span>
                                  {/* wpis raty jest powiązany z zobowiązaniem: zmienia się go przez "Zapłacona", nie edycją */}
                                  {e.source_type !== "LOAN" && (
                                    <Button
                                      variant="ghost"
                                      className="size-9"
                                      aria-label={`Edytuj wydatek ${e.note || CATEGORY_INFO[e.category].label}`}
                                      onClick={() => setEditing(e.id)}
                                    >
                                      <PencilIcon />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    className="size-9"
                                    aria-label={`Usuń wydatek ${e.note || CATEGORY_INFO[e.category].label}`}
                                    onClick={() => ledger.remove(e.id).catch((err) => toast.error(errorMessage(err)))}
                                  >
                                    <Trash2Icon />
                                  </Button>
                                  </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ledger.items.length === 0 && <p className="text-sm text-muted-foreground">Nic jeszcze nie dopisano.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trend: ostatnie miesiące</CardTitle>
          <CardDescription>Wydatki z rejestru w podziale na kategorie</CardDescription>
        </CardHeader>
        <CardContent>
          {ledger.trend.every((m) => m.total === 0) ? (
            <p className="text-sm text-muted-foreground">Wykres pojawi się po dopisaniu pierwszych wydatków.</p>
          ) : (
            <ChartContainer config={config} className="h-56 w-full">
              <BarChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis width={44} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                {BUDGET_CATEGORIES.map((c) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={`var(--color-${c})`} radius={0} />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
