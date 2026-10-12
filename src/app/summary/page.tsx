"use client";

import { ChevronRightIcon, SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import LoginPrompt from "@/components/LoginPrompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, API_URL, type MonthReport } from "@/lib/api";
import { CATEGORY_INFO, money, num } from "@/lib/format";
import { errorMessage } from "@/lib/forms";
import { periodOf, todayIso } from "@/lib/ledger";
import { cn } from "@/lib/utils";

type ExportFormat = "csv" | "json";
type ExportRange = "all" | "week" | "month" | "year" | "custom";

const RANGE_LABEL: Record<ExportRange, string> = {
  all: "Wszystko",
  week: "Ten tydzień",
  month: "Wybrany miesiąc",
  year: "Rok",
  custom: "Własny zakres",
};

const isoDay = (d: Date) => `${periodOf(d)}-${String(d.getDate()).padStart(2, "0")}`;

/** Daty zakresu eksportu (włącznie); `month` to miesiąc oglądany na stronie, od niego liczymy też rok. */
function rangeDates(range: ExportRange, month: string, custom: { from: string; to: string }): { from?: string; to?: string } {
  const [y, m] = month.split("-").map(Number);
  if (range === "week") {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return { from: isoDay(monday), to: isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
  }
  if (range === "month") return { from: `${month}-01`, to: isoDay(new Date(y, m, 0)) };
  if (range === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (range === "custom") return { from: custom.from || undefined, to: custom.to || undefined };
  return {};
}

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  return periodOf(new Date(y, m - 1 + delta, 1));
};

const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });

const signed = (n: number, currency: string) => `${n > 0 ? "+" : ""}${money(n, currency)}`;

/** Zmiana względem poprzedniego miesiąca jednym zdaniem; bez procentu, gdy nie ma do czego porównać. */
function changeText(change: number, percent: number | null, previous: number, currency: string) {
  if (previous === 0 && change === 0) return "bez zmian";
  if (percent == null) return `${signed(change, currency)} (miesiąc wcześniej bez wydatków)`;
  return `${signed(change, currency)} (${percent > 0 ? "+" : ""}${num(percent, 1)}%)`;
}

const chartConfig = {
  spent: { label: "Wydane", color: "var(--chart-1)" },
  budget: { label: "Budżet", color: "var(--chart-2)" },
} satisfies ChartConfig;

export default function SummaryPage() {
  const { ready, loggedIn } = useApp();
  const [month, setMonth] = useState(() => periodOf());
  // ostatnio pobrany raport razem z miesiącem, którego dotyczy (inny miesiąc = trwa ładowanie)
  const [loaded, setLoaded] = useState<{ month: string; report: MonthReport | null } | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [range, setRange] = useState<ExportRange>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api<MonthReport>(`/reports/month?month=${month}`)
      .then((report) => {
        if (!cancelled) setLoaded({ month, report });
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e, "Nie udało się pobrać podsumowania"));
        setLoaded({ month, report: null });
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, month]);

  if (!ready) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!loggedIn) return <LoginPrompt what="Podsumowanie miesiąca" />;

  const current = loaded && loaded.month === month ? loaded : null;
  const loading = current == null;
  const report = current?.report ?? null;
  const isCurrent = month >= periodOf();

  const dates = rangeDates(range, month, custom);
  const rangeInvalid = !!dates.from && !!dates.to && dates.from > dates.to;

  async function download(format: ExportFormat) {
    if (rangeInvalid) {
      toast.error("Początek zakresu nie może być późniejszy niż koniec");
      return;
    }
    setExporting(format);
    try {
      const query = new URLSearchParams({ format, ...(dates.from ? { from: dates.from } : {}), ...(dates.to ? { to: dates.to } : {}) });
      const res = await fetch(`${API_URL}/export?${query}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(`Błąd ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      // nazwa mówi, czego dotyczy plik: zakres dat albo (dla całości) dzień eksportu
      const label = dates.from || dates.to ? `${dates.from ?? "start"}_${dates.to ?? todayIso()}` : todayIso();
      link.download = `worthmytime-${label}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); // przeglądarka musi zdążyć zacząć pobieranie
      toast.success("Eksport pobrany");
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się pobrać eksportu"));
    } finally {
      setExporting(null);
    }
  }

  const currency = report?.currency ?? "PLN";
  const chart = (report?.categories ?? []).map((c) => ({ category: CATEGORY_INFO[c.category].label, spent: c.spent, budget: c.budget }));

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Podsumowanie miesiąca</h1>
          <p className="text-sm text-muted-foreground">Wydatki z rejestru na tle budżetu i poprzedniego miesiąca.</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Wybór miesiąca">
          <Button variant="outline" className="size-11" aria-label="Poprzedni miesiąc" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronRightIcon className="rotate-180" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium capitalize" aria-live="polite" data-testid="summary-month">
            {monthLabel(month)}
          </span>
          <Button variant="outline" className="size-11" aria-label="Następny miesiąc" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {loading && <Skeleton className="h-72 w-full" />}
      {!loading && !report && <p className="text-sm text-muted-foreground">Nie udało się pobrać podsumowania tego miesiąca.</p>}

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="summary-cards">
            <Card size="sm" data-testid="card-total">
              <CardHeader>
                <CardDescription>Wydane łącznie</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{money(report.total_spent, currency)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {changeText(report.change, report.change_percent, report.previous, currency)} względem poprzedniego miesiąca
              </CardContent>
            </Card>
            <Card size="sm" data-testid="card-unspent">
              <CardHeader>
                <CardDescription>Niewydane z dochodu</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{money(report.saved.unspent, currency)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Dochód {money(report.monthly_income, currency)}, w tym odłożone w Przyszłości: {money(report.saved.future, currency)}
                {report.saved.goals != null && report.saved.goals !== 0 && `, wpłaty na cele: ${money(report.saved.goals, currency)}`}
              </CardContent>
            </Card>
            <Card size="sm" data-testid="card-hours">
              <CardHeader>
                <CardDescription>Praca na wydatki uznaniowe</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {report.discretionary.work_hours != null ? `${num(report.discretionary.work_hours, 1)} h` : "brak stawki"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Cele i Przyjemności: {money(report.discretionary.spent, currency)}
              </CardContent>
            </Card>
            <Card size="sm" data-testid="card-largest">
              <CardHeader>
                <CardDescription>Największy wydatek</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {report.largest_expense ? money(report.largest_expense.amount, currency) : "brak"}
                </CardTitle>
              </CardHeader>
              <CardContent className="truncate text-xs text-muted-foreground">
                {report.largest_expense
                  ? `${report.largest_expense.note || CATEGORY_INFO[report.largest_expense.category].label} · ${new Date(`${report.largest_expense.spent_on}T12:00:00`).toLocaleDateString("pl-PL")}`
                  : "W tym miesiącu nie ma wpisów w rejestrze."}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kategorie: wydane i budżet</CardTitle>
              <CardDescription>Raty kredytów liczą się do Potrzeb. Wpisów w miesiącu: {report.entries}.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <BarChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="category" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis width={44} tickLine={false} axisLine={false} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="spent" fill="var(--color-spent)" radius={4} />
                  <Bar dataKey="budget" fill="var(--color-budget)" radius={4} />
                </BarChart>
              </ChartContainer>
              <ul className="divide-y text-sm" data-testid="summary-categories">
                {report.categories.map((c) => (
                  <li key={c.category} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2" data-testid={`summary-${c.category}`}>
                    <span className="font-medium">{CATEGORY_INFO[c.category].label}</span>
                    <span className={cn("tabular-nums", c.available < 0 && "text-destructive")}>
                      {money(c.spent, currency)} / {money(c.budget, currency)}
                      {c.usage_percent != null && ` (${num(c.usage_percent, 0)}%)`}
                    </span>
                    <span className="w-full text-xs text-muted-foreground">
                      {changeText(c.change, c.change_percent, c.previous, currency)} względem poprzedniego miesiąca
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-base">Eksport danych</CardTitle>
          <CardDescription>
            Wydatki, cele, lista życzeń i zapisane obliczenia w jednym pliku: całość albo wybrany zakres dat (wydatki po dacie wydatku, reszta po
            dacie dodania).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div role="radiogroup" aria-label="Zakres eksportu" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(Object.keys(RANGE_LABEL) as ExportRange[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => setRange(r)}
                className={cn(
                  "min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors",
                  range === r ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <label className="grid gap-1.5 text-sm font-medium">
                Od
                <Input type="date" className="h-11" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Do
                <Input type="date" className="h-11" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </label>
            </div>
          )}
          <p className={cn("text-xs text-muted-foreground", rangeInvalid && "text-destructive")} aria-live="polite" data-testid="export-range">
            {rangeInvalid
              ? "Początek zakresu nie może być późniejszy niż koniec."
              : dates.from || dates.to
                ? `Zakres: ${dates.from ?? "od początku"} - ${dates.to ?? "do dziś"}`
                : "Zakres: wszystkie dane"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" disabled={exporting != null} onClick={() => void download("csv")}>
              <SaveIcon /> {exporting === "csv" ? "Pobieram…" : "Pobierz CSV"}
            </Button>
            <Button variant="outline" className="h-11" disabled={exporting != null} onClick={() => void download("json")}>
              <SaveIcon /> {exporting === "json" ? "Pobieram…" : "Pobierz JSON"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
