"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/AppProvider";
import { Field } from "@/components/FormField";
import LoginPrompt from "@/components/LoginPrompt";
import OnboardingCard from "@/components/OnboardingCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type BudgetState, type Category, type GoalDeposit, type SavingsGoal } from "@/lib/api";
import { money, num } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage, optionalNumber, requiredNumber, parseNumber, numeric } from "@/lib/forms";
import { CATEGORY_INFO } from "@/lib/format";
import { useCategoryAvailability } from "@/lib/use-availability";
import { cn } from "@/lib/utils";
import { notifyMoneyChanged } from "@/lib/ledger";

const schema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę").max(200),
  target_amount: requiredNumber("Kwota docelowa").refine((n) => n > 0, "Musi być większa od zera"),
  saved_amount: optionalNumber.refine((n) => n === null || n >= 0, "Nie może być ujemna"),
  monthly_contribution: optionalNumber.refine((n) => n === null || n > 0, "Musi być większa od zera"),
  target_date: z.string(),
  category: z.enum(["", ...BUDGET_CATEGORIES]),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const dateLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });

export default function GoalsPage() {
  const { ready, loggedIn, profile } = useApp();
  const [goals, setGoals] = useState<SavingsGoal[] | null>(null);
  const [currency, setCurrency] = useState("PLN");
  // dostępne środki kategorii po ostatniej zmianie (podpowiedź przy wpłacie); odświeżane razem z celami
  const [available, setAvailable] = useState<Record<Category, number> | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", target_amount: "", saved_amount: "", monthly_contribution: "", target_date: "", category: "" },
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = form;
  const availability = useCategoryAvailability();
  const category = useWatch({ control, name: "category" });
  const free = category && availability ? Math.max(availability[category], 0) : null;

  const load = useCallback(
    () =>
      Promise.all([
        api<{ items: SavingsGoal[]; currency: string }>("/goals").then((r) => {
          setGoals(r.items);
          setCurrency(r.currency);
        }),
        api<BudgetState>("/budget")
          .then((b) => setAvailable(b.available))
          .catch(() => setAvailable(null)),
      ]).catch((e) => toast.error(errorMessage(e, "Nie udało się pobrać celów"))),
    [],
  );

  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn, load]);

  if (!ready) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!loggedIn) return <LoginPrompt what="Cele oszczędnościowe" />;
  if (!profile) return <OnboardingCard />;

  async function submit(v: FormOut) {
    try {
      await api("/goals", {
        body: {
          name: v.name,
          target_amount: v.target_amount,
          saved_amount: v.saved_amount ?? 0,
          monthly_contribution: v.monthly_contribution,
          target_date: v.target_date || null,
          category: v.category || null,
        },
      });
      toast.success("Cel dodany");
      reset();
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się dodać celu"));
    }
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cele oszczędnościowe</h1>
        <p className="text-sm text-muted-foreground">Odkładaj na konkretne rzeczy i patrz, kiedy je osiągniesz.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nowy cel</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
            <Field label="Nazwa celu" error={errors.name?.message}>
              {(p) => <Input {...p} placeholder="np. Wakacje" autoComplete="off" className="h-11" {...register("name")} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kwota docelowa" error={errors.target_amount?.message}>
                {(p) => <Input {...p} inputMode="decimal" placeholder="np. 5000" className="h-11" {...numeric(register("target_amount"))} />}
              </Field>
              <Field label="Już odłożone" error={errors.saved_amount?.message}>
                {(p) => <Input {...p} inputMode="decimal" placeholder="np. 0" className="h-11" {...numeric(register("saved_amount"))} />}
              </Field>
              <Field
                label="Miesięczna wpłata"
                hint={category ? "Zostaw puste, a przyjmiemy maksimum z kategorii" : "Z niej liczymy przewidywaną datę"}
                error={errors.monthly_contribution?.message}
              >
                {(p) => <Input {...p} inputMode="decimal" placeholder="np. 1000" className="h-11" {...numeric(register("monthly_contribution"))} />}
              </Field>
              <Field label="Termin (opcjonalnie)" hint="Policzymy wymaganą wpłatę" error={errors.target_date?.message}>
                {(p) => <Input {...p} type="date" className="h-11" {...register("target_date")} />}
              </Field>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Z której kategorii budżetu odkładasz? (opcjonalnie)</legend>
              <div role="radiogroup" aria-label="Kategoria celu" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(["", ...BUDGET_CATEGORIES] as const).map((c) => (
                  <button
                    key={c || "none"}
                    type="button"
                    role="radio"
                    aria-checked={category === c}
                    onClick={() => setValue("category", c, { shouldDirty: true })}
                    className={cn(
                      "min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors",
                      category === c ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c ? CATEGORY_INFO[c].label : "Bez kategorii"}
                  </button>
                ))}
              </div>
              {category && free != null && (
                <p className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm" data-testid="goal-category-availability">
                  W kategorii <b>{CATEGORY_INFO[category].label}</b> zostało w tym miesiącu <b className="tabular-nums">{money(free, currency)}</b> - tyle maksymalnie możesz miesięcznie odkładać na ten cel.
                  {free > 0 && (
                    <button type="button" className="ml-2 font-medium text-primary underline" onClick={() => setValue("monthly_contribution", String(free), { shouldDirty: true })}>
                      Użyj maksimum
                    </button>
                  )}
                </p>
              )}
            </fieldset>
            <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
              Dodaj cel
            </Button>
          </form>
        </CardContent>
      </Card>

      {goals === null && <Skeleton className="h-40" />}
      {goals?.length === 0 && <p className="text-center text-sm text-muted-foreground">Nie masz jeszcze żadnych celów.</p>}
      {goals?.map((g) => (
        <GoalCard key={g.id} goal={g} currency={currency} available={available} onChange={load} />
      ))}
    </div>
  );
}

function GoalCard({
  goal: g,
  currency,
  available,
  onChange,
}: {
  goal: SavingsGoal;
  currency: string;
  available: Record<Category, number> | null;
  onChange: () => Promise<unknown>;
}) {
  const [amount, setAmount] = useState("");
  const [addExpense, setAddExpense] = useState(true);
  // historia wpłat: null = zwinięta, tablica = pobrana i pokazana
  const [history, setHistory] = useState<GoalDeposit[] | null>(null);
  // wpłata trafia do rejestru w kategorii celu, a gdy cel jej nie ma, w Przyszłości
  const expenseCategory: Category = g.category ?? "FUTURE";
  const typed = parseNumber(amount);
  const left = available && Number.isFinite(typed) && typed > 0 ? available[expenseCategory] - typed : null;

  const loadHistory = () =>
    api<{ items: GoalDeposit[] }>(`/goals/${g.id}/deposits`)
      .then((r) => setHistory(r.items))
      .catch((e) => toast.error(errorMessage(e, "Nie udało się pobrać historii wpłat")));

  async function undoDeposit(d: GoalDeposit) {
    try {
      await api(`/goals/${g.id}/deposits/${d.id}`, { method: "DELETE" });
      toast.success(d.in_ledger ? "Wpłata cofnięta, wydatek usunięty z rejestru" : "Cofnięto");
      notifyMoneyChanged();
      await Promise.all([onChange(), loadHistory()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function deposit(sign: 1 | -1) {
    const value = parseNumber(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Podaj kwotę większą od zera");
      return;
    }
    try {
      // wypłata nigdy nie tworzy wydatku, więc pytanie o rejestr dotyczy tylko wpłaty
      await api(`/goals/${g.id}/deposit`, { body: sign === 1 ? { amount: value, add_expense: addExpense } : { amount: -value } });
      setAmount("");
      notifyMoneyChanged();
      toast.success(sign === 1 ? (addExpense ? "Wpłata dopisana, także do wydatków" : "Wpłata dopisana") : "Wypłata zapisana");
      await Promise.all([onChange(), history ? loadHistory() : null]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove() {
    try {
      await api(`/goals/${g.id}`, { method: "DELETE" });
      await onChange();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card data-testid={`goal-${g.id}`} data-completed={g.completed}>
      <CardContent className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium">
              {g.completed && <CheckCircle2Icon className="size-4 shrink-0 text-primary" aria-hidden />}
              {g.name}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {money(g.saved_amount, currency)} z {money(g.target_amount, currency)}
              {g.category && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs">{CATEGORY_INFO[g.category].label}</span>}
            </p>
          </div>
          <Button variant="ghost" className="size-10" aria-label={`Usuń cel ${g.name}`} onClick={remove}>
            <Trash2Icon />
          </Button>
        </div>

        <div className="grid gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Postęp</span>
            <span className="tabular-nums" data-testid="goal-percent">
              {num(g.percent, 1)}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Postęp: ${g.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(g.percent))}>
            <div className={cn("h-full rounded-full", g.completed ? "bg-primary" : "bg-primary/80")} style={{ width: `${Math.min(100, g.percent)}%` }} />
          </div>
        </div>

        {g.completed ? (
          <p className="text-sm font-medium text-primary">Cel osiągnięty.</p>
        ) : (
          <dl className="grid gap-1 text-sm">
            <Row label="Zostało do odłożenia" value={`${money(g.remaining, currency)}${g.work_hours_remaining != null ? ` (${num(g.work_hours_remaining, 0)} h pracy)` : ""}`} />
            {g.max_monthly_contribution != null && (
              <Row
                label={`Maks. wpłata z kategorii „${g.category ? CATEGORY_INFO[g.category].label : ""}” w tym miesiącu`}
                value={money(g.max_monthly_contribution, currency)}
                testId="goal-max"
              />
            )}
            {g.eta && (
              <Row
                label={`Przy ${money(g.effective_contribution ?? 0, currency)}/mies.${g.contribution_source === "CATEGORY_AVAILABLE" ? " (maksimum)" : ""} cel osiągniesz`}
                value={`${dateLabel(g.eta)} (${num(g.months_to_goal ?? 0, 1)} mies.)`}
                testId="goal-eta"
              />
            )}
            {g.required_monthly != null && (
              <Row label={`Żeby zdążyć do ${g.target_date ? dateLabel(g.target_date) : "terminu"}, odkładaj`} value={`${money(g.required_monthly, currency)}/mies.`} />
            )}
            {g.contribution_exceeds && (
              <div className="pt-1">
                <Badge variant="destructive" data-testid="goal-exceeds">
                  wpłata większa niż dostępne w kategorii
                </Badge>
              </div>
            )}
            {g.on_track != null && (
              <div className="pt-1">
                <Badge variant={g.on_track ? "secondary" : "destructive"} data-testid="goal-track">
                  {g.on_track ? "zdążysz w terminie" : "przy tej wpłacie nie zdążysz w terminie"}
                </Badge>
              </div>
            )}
          </dl>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={`Kwota wpłaty: ${g.name}`} inputMode="decimal" placeholder="Kwota" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 w-32" />
          <Button className="h-10" onClick={() => deposit(1)}>
            Wpłać
          </Button>
          <Button variant="outline" className="h-10" onClick={() => deposit(-1)}>
            Wypłać
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={addExpense} onChange={(e) => setAddExpense(e.target.checked)} />
          <span>
            Dopisz wpłatę do wydatków ({CATEGORY_INFO[expenseCategory].label})
            <span className="block text-xs text-muted-foreground" data-testid="deposit-impact">
              {!addExpense
                ? "Wpłata zmieni tylko postęp celu, bez wpisu w rejestrze wydatków."
                : left == null
                  ? `Wpłata obciąży budżet kategorii ${CATEGORY_INFO[expenseCategory].label}.`
                  : left >= 0
                    ? `Po wpłacie w kategorii ${CATEGORY_INFO[expenseCategory].label} zostanie ${money(left, currency)}.`
                    : `Wpłata przekroczy dostępne środki kategorii ${CATEGORY_INFO[expenseCategory].label} o ${money(-left, currency)}.`}
            </span>
          </span>
        </label>

        <div className="grid gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            aria-expanded={history != null}
            onClick={() => (history ? setHistory(null) : void loadHistory())}
          >
            {history ? "Ukryj historię wpłat" : "Historia wpłat"}
          </Button>
          {history && history.length === 0 && <p className="text-sm text-muted-foreground">Brak wpłat.</p>}
          {history && history.length > 0 && (
            <ul className="divide-y text-sm" data-testid="deposit-history">
              {history.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-muted-foreground">{new Date(`${d.deposited_on}T12:00:00`).toLocaleDateString("pl-PL")}</span>
                  <span className="flex items-center gap-2">
                    {d.in_ledger && <Badge variant="secondary">w wydatkach</Badge>}
                    <span className="tabular-nums font-medium">
                      {d.amount > 0 ? "+" : ""}
                      {money(d.amount, currency)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Cofnij ${d.amount > 0 ? "wpłatę" : "wypłatę"} ${money(Math.abs(d.amount), currency)}`}
                      onClick={() => undoDeposit(d)}
                    >
                      Cofnij
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="shrink-0 text-right font-medium tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
