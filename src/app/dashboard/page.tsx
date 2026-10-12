"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import LoginPrompt from "@/components/LoginPrompt";
import OnboardingCard from "@/components/OnboardingCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type BudgetState, type MonthReport, type MonthSummary, type RecurringExpense, type SavedCalculation } from "@/lib/api";
import { CATEGORY_INFO, money, num } from "@/lib/format";
import { errorMessage } from "@/lib/forms";
import { countsThisMonth } from "@/lib/loans";

const MONTHS = 6;

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("pl-PL", { month: "short", year: "2-digit" });

/** Roczny koszt subskrypcji zapisanej w kalkulatorze (obliczenie typu "koszt cykliczny"). */
const yearly = (c: SavedCalculation) => c.result.horizons?.find((h) => h.label === "1 year");

interface Data {
  report: MonthReport;
  trend: MonthSummary[];
  budget: BudgetState;
  recurring: RecurringExpense[];
  calculations: SavedCalculation[];
}

/**
 * Dashboard: prawdziwe pieniądze z rejestru wydatków (ten miesiąc, ostatnie miesiące, koszty cykliczne).
 * Zakupy przeliczone w kalkulatorze są osobno, na dole, bo to rozważane zakupy, a nie wydatki.
 */
export default function DashboardPage() {
  const { ready, loggedIn, profile } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loggedIn || !profile) return;
    let cancelled = false;
    Promise.all([
      api<MonthReport>("/reports/month"),
      api<{ months: MonthSummary[] }>(`/expenses/summary?months=${MONTHS}`),
      api<BudgetState>("/budget"),
      api<{ items: RecurringExpense[] }>("/recurring-expenses"),
      // zapisane obliczenia to dodatek: bez nich reszta strony ma sens
      api<{ items: SavedCalculation[] }>("/calculations").catch(() => ({ items: [] as SavedCalculation[] })),
    ])
      .then(([report, summary, budget, recurring, calculations]) => {
        if (!cancelled) setData({ report, trend: summary.months, budget, recurring: recurring.items, calculations: calculations.items });
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e, "Nie udało się pobrać danych"));
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, profile]);

  if (!ready) return <Skeleton className="h-64 w-full" />;
  if (!loggedIn) return <LoginPrompt what="Dashboard" />;
  if (!profile) return <OnboardingCard />;
  if (failed) return <p className="text-sm text-muted-foreground">Nie udało się pobrać danych do dashboardu. Odśwież stronę, żeby spróbować ponownie.</p>;
  if (!data)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );

  const { report, trend, budget, recurring, calculations } = data;
  const currency = report.currency;
  const largest = report.largest_expense;

  // koszty cykliczne: raty obciążające ten miesiąc, aktywne stałe wydatki i subskrypcje zapisane w kalkulatorze
  const loans = budget.loans.filter((l) => countsThisMonth(l));
  const fixed = recurring.filter((r) => r.active);
  const subscriptions = calculations.filter((c) => c.type === "RECURRING");
  const cyclic = [
    ...loans.map((l) => ({ key: `loan-${l.id ?? l.name}`, name: l.name, kind: "rata", monthly: l.installment_amount })),
    ...fixed.map((r) => ({ key: `fixed-${r.id}`, name: r.name, kind: "stały wydatek", monthly: r.amount })),
    ...subscriptions.map((c) => ({ key: `sub-${c.id}`, name: c.name, kind: "subskrypcja z kalkulatora", monthly: (yearly(c)?.cost ?? 0) / 12 })),
  ];
  const cyclicMonthly = cyclic.reduce((s, x) => s + x.monthly, 0);

  // wykres: rejestr z ostatnich miesięcy; raty dochodzą w każdym miesiącu jako stałe zobowiązanie
  const chart = trend.map((m) => ({ month: monthLabel(m.month), total: Math.round(m.total * 100) / 100 }));
  const chartConfig = { total: { label: "Wydatki z rejestru", color: "var(--chart-1)" } } satisfies ChartConfig;

  const purchases = calculations.filter((c) => c.type !== "RECURRING");
  const change =
    report.previous === 0
      ? "miesiąc wcześniej bez wydatków"
      : `${report.change > 0 ? "+" : ""}${money(report.change, currency)} względem poprzedniego miesiąca`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Twoje prawdziwe wydatki z rejestru: ten miesiąc, ostatnie miesiące i koszty, które wracają co miesiąc.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-metrics">
        <Metric testId="metric-total" label="Wydane w tym miesiącu" value={money(report.total_spent, currency)} sub={change} />
        <Metric
          testId="metric-largest"
          label="Największy wydatek"
          value={largest ? money(largest.amount, currency) : "brak"}
          sub={largest ? largest.note || CATEGORY_INFO[largest.category].label : "w tym miesiącu nie ma wpisów"}
        />
        <Metric
          testId="metric-hours"
          label="Praca na Cele i Przyjemności"
          value={report.discretionary.work_hours != null ? `${num(report.discretionary.work_hours, 1)} h` : "brak stawki"}
          sub={money(report.discretionary.spent, currency)}
        />
        <Metric testId="metric-unspent" label="Niewydane z dochodu" value={money(report.saved.unspent, currency)} sub={`dochód ${money(report.monthly_income, currency)}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wydatki w ostatnich miesiącach</CardTitle>
          <CardDescription>
            Suma wpisów z rejestru w każdym miesiącu. Szczegóły miesiąca są w{" "}
            <Link href="/summary" className="text-primary underline">
              Podsumowaniu
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chart.every((m) => m.total === 0) ? (
            <p className="text-sm text-muted-foreground">Wykres pojawi się po dopisaniu pierwszych wydatków.</p>
          ) : (
            <ChartContainer config={chartConfig} className="h-56 w-full" data-testid="dashboard-chart">
              <BarChart data={chart} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis width={44} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" fill="var(--color-total)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card data-testid="dashboard-cyclic">
        <CardHeader>
          <CardTitle>Wydatki cykliczne</CardTitle>
          <CardDescription>
            {cyclic.length > 0 ? (
              <>
                Razem miesięcznie: <b className="text-foreground">{money(cyclicMonthly, currency)}</b> · rocznie {money(cyclicMonthly * 12, currency)}
              </>
            ) : (
              "Raty kredytów, stałe wydatki i subskrypcje, które wracają co miesiąc."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cyclic.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Brak kosztów cyklicznych. Kredyty i stałe wydatki dodasz na stronie{" "}
              <Link href="/expenses" className="text-primary underline">
                Wydatki
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {cyclic.map((x) => (
                <li key={x.key} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{x.name}</span>
                    <span className="text-xs text-muted-foreground">{x.kind}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{money(x.monthly, currency)} / mies.</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="dashboard-analyzed">
        <CardHeader>
          <CardTitle>Zakupy przeliczone w kalkulatorze</CardTitle>
          <CardDescription>To rozważane zakupy zapisane w historii, a nie wydatki: nie wchodzą do liczb powyżej.</CardDescription>
        </CardHeader>
        <CardContent>
          {purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nie masz jeszcze zapisanych obliczeń.{" "}
              <Link href="/calculator" className="text-primary underline">
                Policz zakup
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm">
              {purchases.length} {purchases.length === 1 ? "zakup" : "zakupów"} o wartości{" "}
              <b className="tabular-nums">{money(purchases.reduce((s, c) => s + c.result.total_cost, 0), currency)}</b>, czyli{" "}
              <b className="tabular-nums">{num(purchases.reduce((s, c) => s + c.result.work.hours, 0), 1)} h</b> pracy.{" "}
              <Link href="/history" className="text-primary underline">
                Zobacz historię
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <Card size="sm" data-testid={testId}>
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums sm:text-xl">{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}
