"use client";

import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import BudgetCard from "./BudgetCard";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Result } from "@/lib/api";
import { FREQ_LABEL, HORIZON_LABEL, hm, money, monthsLabel, num, yearsLabel } from "@/lib/format";

const LINE_LABEL: Record<string, string> = { Purchase: "Zakup", Resale: "Odsprzedaż" };
const lineName = (n: string) => LINE_LABEL[n] ?? n;

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export default function ResultView({ result, currency = "PLN" }: { result: Result; currency?: string }) {
  // koszt cykliczny: nagłówek to zawsze JEDEN miesiąc (1 800 zł / mies.), a horyzonty niżej pokazują narastanie.
  // Bierzemy go z horyzontu "1 month", więc działa też ze starszym API, które w nagłówku dawało sumę z 10 lat.
  const recurring = result.type === "RECURRING";
  const month = recurring ? result.horizons?.find((h) => h.label === "1 month") : undefined;
  const w = month?.work ?? result.work;
  const headlineCost = month?.cost ?? result.total_cost;

  return (
    <div className="grid gap-4">
      <section
        aria-label="Wynik"
        className="relative isolate grid gap-[18px] overflow-hidden rounded-[26px] bg-brand px-[18px] py-[22px] text-brand-foreground shadow-[0_30px_60px_-36px] shadow-brand sm:p-7"
      >
        <svg
          aria-hidden
          width="300"
          height="300"
          viewBox="0 0 320 320"
          fill="none"
          className="pointer-events-none absolute -top-[130px] -right-[130px] -z-10"
        >
          <circle cx="160" cy="160" r="150" stroke="#ffffff12" strokeWidth="2" />
          <circle cx="160" cy="160" r="110" stroke="#ffffff0d" strokeWidth="2" />
          <circle cx="160" cy="160" r="70" stroke="#ffffff0a" strokeWidth="2" />
        </svg>
        <div>
          <p className="text-sm text-brand-muted">{result.name}</p>
          <p className="text-lg font-semibold tabular-nums">
            {money(headlineCost, currency)}
            {recurring && <span className="text-sm font-normal text-brand-muted"> / miesiąc</span>}
          </p>
        </div>
        <div>
          <p className="text-sm text-brand-muted">{recurring ? "kosztuje Cię miesięcznie" : "kosztuje Cię"}</p>
          <p
            className="font-heading text-[5.75rem] leading-[0.95] font-extrabold tracking-[-0.045em] text-lime tabular-nums sm:text-[6.5rem]"
            data-testid="hours"
          >
            {num(w.hours, 1)}
            <span className="ml-1.5 text-4xl font-bold tracking-normal">h</span>
          </p>
          <p className="mt-1.5 text-sm text-brand-muted">pracy ({hm(w.hours_part, w.minutes_part)})</p>
        </div>

        {w.income_percent != null && <IncomeShare percent={w.income_percent} recurring={recurring} />}

        {w.working_months != null && (
          <section aria-labelledby="scale-month" className="grid gap-2.5 rounded-[18px] border border-white/10 bg-white/[0.06] p-3.5">
            <h3 id="scale-month" className="text-[11px] font-semibold tracking-[0.1em] text-brand-muted uppercase">
              W skali miesiąca
            </h3>
            <p className="font-heading text-[26px] font-bold tabular-nums" data-testid="months">
              {w.working_months < 1 ? num(w.working_months, 2) : monthsLabel(Math.round(w.working_months * 10) / 10)}
              {w.working_months < 1 && <span className="font-sans text-sm font-medium text-white/85"> miesiąca pracy</span>}
              {w.working_months >= 1 && <span className="font-sans text-sm font-medium text-white/85"> pracy</span>}
            </p>
            <MonthStrip months={w.working_months} />
            <p className="text-xs text-brand-muted">1 klocek = 1 miesiąc pracy</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <Stat value={num(w.working_days, 1)} label="dni roboczych" />
              <Stat value={num(w.working_weeks, 1)} label="tygodni roboczych" />
            </div>
          </section>
        )}

        {!recurring && (
          <section aria-labelledby="scale-year" className="grid gap-2.5 rounded-[18px] border border-white/10 bg-white/[0.06] p-3.5">
            <h3 id="scale-year" className="text-[11px] font-semibold tracking-[0.1em] text-brand-muted uppercase">
              W skali lat
            </h3>
            <p className="font-heading text-[26px] font-bold tabular-nums" data-testid="years">
              {/* poniżej roku ułamek ("0,01 roku") nic nie mówi, więc pokazujemy udział w roku pracy w procentach */}
              {w.working_years >= 1
                ? yearsLabel(Math.round(w.working_years * 100) / 100)
                : w.working_years < 0.01
                  ? "poniżej 1%"
                  : `${num(w.working_years * 100, 0)}%`}
              <span className="font-sans text-sm font-medium text-white/85">{w.working_years < 1 ? " roku pracy" : " pracy"}</span>
            </p>
            <ProgressBar value={w.working_years * 100} label="Udział w roku pracy" />
          </section>
        )}

        {result.hourly_rate != null && (
          <p className="text-xs text-brand-muted">Efektywna stawka: {money(result.hourly_rate, currency)}/h</p>
        )}
      </section>
      {result.budget && <BudgetCard budget={result.budget} currency={currency} />}

      {result.per_use && (
        <Card data-testid="per-use">
          <CardHeader>
            <CardTitle>Koszt jednego użycia</CardTitle>
            <CardDescription>Przy {num(result.per_use.uses, 0)} użyciach</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-center sm:gap-3">
            <Stat tone="light" value={money(result.per_use.cost, currency)} label="za jedno użycie" />
            <Stat tone="light" value={`${num(result.per_use.work_minutes, 1)} min`} label="Twojej pracy" />
          </CardContent>
        </Card>
      )}

      {!recurring && w.income_percent != null && w.income_percent > 0 && (
        <Card size="sm" data-testid="equivalents">
          <CardHeader>
            <CardTitle className="text-base">Dla porównania</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
              <li>
                To około <b className="text-foreground">{num(w.working_days, 1)} dni</b> roboczych - tyle, co {num(w.working_days, 1)} dni
                urlopu bez wypłaty.
              </li>
              <li>
                To <b className="text-foreground">{num(w.income_percent / 12, 1)}%</b> Twojego rocznego dochodu netto.
              </li>
              {w.working_months >= 1 && (
                <li>
                  Pracujesz na to <b className="text-foreground">{monthsLabel(Math.round(w.working_months * 10) / 10)}</b>.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {result.horizons && <HorizonsCard result={result} currency={currency} />}

      {result.summary && (
        <p className="text-center text-sm">
          {result.summary.years} lat tego wydatku to około <b>{num(result.summary.working_days, 1)}</b> dni roboczych.
        </p>
      )}

      {result.type !== "RECURRING" && result.breakdown.length > 1 && <BreakdownCard result={result} currency={currency} />}

      {result.type === "RECURRING" && (
        <Card>
          <CardHeader>
            <CardTitle>Pozycje</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {result.breakdown.map((b, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{b.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(b.amount, currency)} <span className="text-muted-foreground">{b.frequency && FREQ_LABEL[b.frequency]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result.life_cost && (
        <Card>
          <CardHeader>
            <CardTitle>Gdy używasz tego przez {yearsLabel(result.life_cost.years)}</CardTitle>
            <CardDescription>Koszt rozłożony w czasie</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-center sm:gap-3">
            <Stat value={money(result.life_cost.per_day, currency)} label="dziennie" tone="light" />
            <Stat value={money(result.life_cost.per_week, currency)} label="tygodniowo" tone="light" />
            <Stat value={money(result.life_cost.per_month, currency)} label="miesięcznie" tone="light" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HorizonsCard({ result, currency }: { result: Result; currency: string }) {
  const data = (result.horizons ?? []).map((h) => ({
    label: HORIZON_LABEL[h.label] ?? h.label,
    hours: h.work.hours,
    cost: h.cost,
    time: hm(h.work.hours_part, h.work.minutes_part),
    percent: h.work.income_percent,
  }));
  const config = { hours: { label: "Godziny pracy", color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jak to narasta w czasie</CardTitle>
        <CardDescription>Od jednego miesiąca po lata: ile pracy i miesięcznych wypłat pochłonie ta opłata</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ChartContainer config={config} className="h-48 w-full">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis width={36} tickLine={false} axisLine={false} fontSize={12} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="hours" fill="var(--color-hours)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartContainer>
        <ul className="divide-y text-sm">
          {data.map((h) => (
            <li key={h.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-2">
              <span>{h.label}</span>
              <span className="text-right tabular-nums">{money(h.cost, currency)}</span>
              <span className="min-w-20 text-right tabular-nums">
                <span className="font-medium">{h.time}</span>
                {h.percent != null && <span className="block text-xs text-muted-foreground">{shareLabel(h.percent)}</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ result, currency }: { result: Result; currency: string }) {
  const positive = result.breakdown.filter((b) => b.amount > 0);
  const data = positive.map((b, i) => ({ name: lineName(b.name), value: b.amount, fill: COLORS[i % COLORS.length] }));
  const config = Object.fromEntries(data.map((d) => [d.name, { label: d.name, color: d.fill }])) satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rozbicie kosztów</CardTitle>
      </CardHeader>
      <CardContent className="grid items-center gap-4 sm:grid-cols-[12rem_1fr]">
        <ChartContainer config={config} className="mx-auto aspect-square h-44 sm:h-48">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" strokeWidth={2} />
          </PieChart>
        </ChartContainer>
        <ul className="text-sm">
          {result.breakdown.map((b, i) => {
            const color = b.amount > 0 ? COLORS[positive.indexOf(b) % COLORS.length] : undefined;
            return (
              <li key={i} className="flex items-center justify-between gap-3 border-b py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-sm bg-muted-foreground/40" style={color ? { background: color } : undefined} />
                  <span className="truncate">{lineName(b.name)}</span>
                </span>
                <span className="shrink-0 tabular-nums">{money(b.amount, currency)}</span>
              </li>
            );
          })}
          <li className="flex justify-between gap-3 pt-2 font-semibold">
            <span>Razem</span>
            <span className="tabular-nums">{money(result.total_cost, currency)}</span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function Stat({ value, label, tone = "dark" }: { value: string; label: string; tone?: "dark" | "light" }) {
  return (
    <div className={tone === "dark" ? "rounded-xl bg-white/[0.07] px-1 py-2.5" : "rounded-xl bg-muted/60 px-1 py-2.5"}>
      <div className="font-heading text-lg font-bold tabular-nums sm:text-xl">{value}</div>
      <div className={`text-xs leading-tight ${tone === "dark" ? "text-brand-muted" : "text-muted-foreground"}`}>{label}</div>
    </div>
  );
}

/** Procent miesięcznej wypłaty - uświadamia skalę wydatku. */
/** Procent poniżej 100, a od 100 wielokrotność wypłaty (27× czytelniejsze niż 2 700%). */
function shareLabel(percent: number) {
  return percent >= 100 ? `${num(percent / 100, 1)}× wypłaty` : `${num(percent, 1)}% wypłaty`;
}

function IncomeShare({ percent, recurring = false }: { percent: number; recurring?: boolean }) {
  if (percent <= 0) return null;
  const multiple = percent >= 100;
  // pierścień pokazuje procent wypłaty; od 100% zostaje pełny
  const dash = (Math.min(percent, 100) / 100) * 314.2;
  return (
    <div className="flex items-center gap-3.5 rounded-[18px] bg-white/[0.07] px-3.5 py-3" data-testid="income-share">
      <div className="relative size-[60px] flex-none">
        <svg width="60" height="60" viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="50" fill="none" stroke="#ffffff26" strokeWidth="14" />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke={percent >= 100 ? "#f2a3b8" : "#b8f26b"}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${dash} 314.2`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[13px] font-bold tabular-nums">
          {multiple ? `${num(percent / 100, 1)}×` : `${num(percent, 0)}%`}
        </span>
      </div>
      <div>
        {multiple ? (
          <p className="text-base leading-snug font-semibold">
            To <span className="tabular-nums">{num(percent / 100, 1)}×</span> Twojej miesięcznej wypłaty
          </p>
        ) : (
          <p className="text-base leading-snug font-semibold">
            To <span className="tabular-nums">{num(percent, 1)}%</span> Twojej miesięcznej wypłaty
          </p>
        )}
        <p className="mt-0.5 text-xs text-brand-muted">
          {recurring
            ? "Tyle z miesięcznej pracy pochłania ta opłata - co miesiąc."
            : multiple
              ? "Tyle miesięcy pracy oddajesz za ten wydatek."
              : "Tyle z miesięcznej pracy pochłania ten wydatek."}
        </p>
      </div>
    </div>
  );
}

/** 12 klocków = 12 miesięcy; wypełnienie pokazuje, ile miesięcy pracy kosztuje wydatek. */
function MonthStrip({ months }: { months: number }) {
  const shown = Math.min(12, Math.max(0, months));
  return (
    <div
      role="img"
      aria-label={`${months < 1 ? num(months, 2) + " miesiąca" : monthsLabel(Math.round(months * 10) / 10)} pracy`}
      className="grid grid-cols-12 gap-1"
    >
      {Array.from({ length: 12 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, shown - i));
        return (
          <span key={i} className="h-3.5 overflow-hidden rounded bg-white/[0.12]">
            <span className="block h-full bg-lime" style={{ width: `${fill * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-3.5 overflow-hidden rounded-full bg-white/[0.12]"
    >
      <div className="h-full min-w-2 rounded-full bg-lime transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
