"use client";

import { AlertTriangleIcon, InfoIcon, OctagonAlertIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import type { BudgetAnalysis, BudgetWarning, WarningLevel } from "@/lib/api";
import { CATEGORY_INFO, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const pct = (n: number | string | null | undefined) => (typeof n === "number" ? `${num(n, 1)}%` : "-");

/** Treść ostrzeżenia z kodu i parametrów zwróconych przez API (reguły: WorthMyTime_Budget_Model.md, sekcja 15). */
export function warningText(w: BudgetWarning, currency: string): { title: string; body: string } {
  const p = w.params;
  const m = (k: string) => money(Number(p[k] ?? 0), currency);
  const cat = typeof p.category === "string" ? CATEGORY_INFO[p.category as keyof typeof CATEGORY_INFO]?.label : "";

  switch (w.code) {
    case "CATEGORY_BUDGET_EXCEEDED":
      return {
        title: "To może nie mieścić się w Twoim planie budżetowym",
        body:
          p.projected_usage_percent == null
            ? `Kategoria „${cat}” nie ma przydzielonego budżetu, a ten wydatek to ${m("overrun")} ponad plan.`
            : `Po tym zakupie wydatki w kategorii „${cat}” wyniosą ${pct(p.projected_usage_percent)} jej miesięcznego budżetu - o ${m("overrun")} ponad plan. W tym miesiącu zostało w niej ${m("available")}. Jednorazowo się nie zmieści, ale możesz rozłożyć zakup w czasie - patrz maksymalna miesięczna wpłata poniżej.`,
      };
    case "MONTHLY_COST_EXCEEDS_AVAILABLE":
      return {
        title: "Ta miesięczna opłata może nie mieścić się w budżecie",
        body: `Opłata ${m("monthly_cost")} miesięcznie jest większa niż dostępne teraz w kategorii „${cat}” (${m("available")}). Brakuje ${m("overrun")} co miesiąc.`,
      };
    case "BUDGET_DEFICIT":
      return {
        title: "Plan wydatków przekracza dochód",
        body: `Razem z tym wydatkiem zaplanowane wydatki (${m("planned_expenses")}) są wyższe niż miesięczny dochód (${m("monthly_income")}) o ${m("deficit")}.`,
      };
    case "LOANS_EXCEED_NEEDS_BUDGET":
      return {
        title: "Raty kredytów zjadają cały budżet Potrzeb",
        body: `Same raty (${m("monthly_loans")} miesięcznie) są wyższe niż budżet kategorii Potrzeby (${m("needs_budget")}) o ${m("overrun")}. Na pozostałe potrzeby i nowe wydatki zabraknie środków.`,
      };
    case "CONTRIBUTION_EXCEEDS_AVAILABLE":
      return {
        title: "Ta wpłata nie mieści się w budżecie kategorii",
        body: `Planujesz odkładać ${m("planned")} miesięcznie, a z kategorii „${cat}” możesz w tym miesiącu przeznaczyć najwyżej ${m("max_monthly")} - brakuje ${m("overrun")}. Zmniejsz wpłatę albo wydłuż czas oszczędzania.`,
      };
    case "NO_FREE_BUDGET":
      return {
        title: "W tym miesiącu nie ma wolnych środków",
        body: `W kategorii „${cat}” nie zostało nic wolnego (${m("available")}), więc nie ma z czego odkładać na ten wydatek, dopóki budżet się nie odnowi albo nie zmienisz procentów.`,
      };
    case "HIGHER_PRIORITY_AT_RISK":
      return {
        title: "Sięgnięcie po środki z ważniejszych kategorii",
        body: `Kategoria „${cat}” ma niski priorytet (${p.priority}). Żeby sfinansować ten wydatek, trzeba by uszczuplić kategorie ważniejsze, jak Potrzeby czy Przyszłość, o około ${m("shortfall")} - albo rozłożyć zakup w czasie.`,
      };
    case "CATEGORY_BUDGET_TIGHT":
      return {
        title: "Mieści się, ale zajmie większość budżetu kategorii",
        body: `Wydatki w „${cat}” osiągną ${pct(p.projected_usage_percent)} jej miesięcznego budżetu.`,
      };
    case "NO_BUDGET_DATA":
      return {
        title: "Liczymy z domyślnego budżetu",
        body: "Nie ustawiłeś własnego planu, więc używamy podziału 50/25/15/10 i zakładamy, że w tej kategorii nic jeszcze nie wydałeś.",
      };
  }
}

const LEVEL_STYLE: Record<WarningLevel, { box: string; icon: typeof InfoIcon }> = {
  critical: { box: "border-destructive/40 bg-destructive/10", icon: OctagonAlertIcon },
  warning: { box: "border-chart-3/50 bg-chart-3/15", icon: AlertTriangleIcon },
  info: { box: "border-border bg-muted/50", icon: InfoIcon },
};

const LEVEL_ORDER: Record<WarningLevel, number> = { critical: 0, warning: 1, info: 2 };

export default function BudgetCard({ budget, currency = "PLN" }: { budget: BudgetAnalysis; currency?: string }) {
  const info = CATEGORY_INFO[budget.category];
  const warnings = [...budget.warnings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const mainUsage = budget.upfront?.projected_usage_percent ?? budget.monthly?.projected_usage_percent ?? null;
  const over = mainUsage != null ? mainUsage > 100 : !budget.fits_budget;

  return (
    <Card data-testid="budget-card" data-fits={budget.fits_budget}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Plan budżetowy
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {info.label} · {info.priority}
          </span>
        </CardTitle>
        <CardDescription>
          Budżet kategorii: {money(budget.category_budget, currency)} miesięcznie ({num(budget.percentage, 1)}% dochodu)
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {warnings.length > 0 && (
          <ul className="grid gap-2" aria-label="Ostrzeżenia budżetowe">
            {warnings.map((w) => {
              const { title, body } = warningText(w, currency);
              const { box, icon: Icon } = LEVEL_STYLE[w.level];
              return (
                <li key={w.code} data-testid={`warning-${w.code}`} data-level={w.level} className={cn("flex gap-3 rounded-xl border p-3", box)}>
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div className="grid gap-0.5 text-sm">
                    <p className="font-semibold">{title}</p>
                    <p className="text-muted-foreground">{body}</p>
                    {w.code === "NO_BUDGET_DATA" && (
                      <Link href="/budget" className="mt-1 font-medium text-primary underline">
                        Ustaw własny budżet
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {budget.fits_budget && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheckIcon className="size-4 text-primary" aria-hidden /> Mieści się w budżecie tej kategorii (przy Twoich założeniach).
          </p>
        )}

        {budget.obligations && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm" data-testid="obligations">
            Raty kredytów i pożyczek:{" "}
            <b className="tabular-nums">{money(budget.obligations.monthly_installments, currency)}</b> miesięcznie (
            {pct(budget.obligations.income_percent)} dochodu), ostatnia rata za {budget.obligations.last_installment_in_months}{" "}
            mies.
            {budget.obligations.included_in_category
              ? " Są już wliczone w wydane w tej kategorii."
              : " Liczą się do Potrzeb, więc wpływają na ogólny bilans miesiąca."}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          <Fact label="Budżet" value={money(budget.category_budget, currency)} />
          <Fact label="Wydane" value={money(budget.spent, currency)} />
          <Fact label="Dostępne" value={money(budget.available, currency)} negative={budget.available < 0} />
        </div>

        {budget.upfront && (
          <section className="grid gap-2" aria-label="Zakup jednorazowy">
            <UsageBar
              label="Wykorzystanie budżetu po zakupie"
              spent={budget.spent}
              add={budget.upfront.cost}
              budget={budget.category_budget}
              percent={budget.upfront.projected_usage_percent}
              over={over}
            />
            <p
              className="rounded-lg bg-primary/10 px-3 py-2 text-sm"
              data-testid="max-contribution"
            >
              Na ten wydatek możesz przeznaczyć miesięcznie maksymalnie{" "}
              <b className="tabular-nums">{money(budget.upfront.max_monthly_contribution, currency)}</b> - tyle zostało w kategorii „{info.label}” w tym
              miesiącu.
              {budget.upfront.contribution_source === "USER" && budget.upfront.monthly_contribution > budget.upfront.max_monthly_contribution && (
                <span className="text-destructive"> Planujesz więcej: {money(budget.upfront.monthly_contribution, currency)}.</span>
              )}
            </p>
            <dl className="grid gap-1 text-sm">
              <Row label={`Zakup to ${pct(budget.upfront.purchase_share_percent)} miesięcznego budżetu „${info.label}”`} />
              <Row label="Udział w miesięcznym dochodzie" value={pct(budget.upfront.income_percent)} />
              {budget.upfront.coverage_ratio != null && (
                <Row label="Udział w dostępnym budżecie kategorii" value={pct(budget.upfront.coverage_ratio)} />
              )}
              {budget.upfront.months_to_goal != null && (
                <Row
                  label={`Czas oszczędzania przy odkładaniu ${money(budget.upfront.monthly_contribution, currency)}/mies.${
                    budget.upfront.contribution_source === "CATEGORY_AVAILABLE" ? " (maksimum z kategorii)" : ""
                  }`}
                  value={`${num(budget.upfront.months_to_goal, 1)} mies.${
                    budget.upfront.months_to_goal_full != null && !Number.isInteger(budget.upfront.months_to_goal)
                      ? ` (ok. ${budget.upfront.months_to_goal_full})`
                      : ""
                  }`}
                  testId="months-to-goal"
                />
              )}
            </dl>
          </section>
        )}

        {budget.monthly && (
          <section className="grid gap-2" aria-label="Opłata miesięczna">
            <UsageBar
              label="Wykorzystanie budżetu z tą opłatą co miesiąc"
              spent={budget.spent}
              add={budget.monthly.cost}
              budget={budget.category_budget}
              percent={budget.monthly.projected_usage_percent}
              over={(budget.monthly.projected_usage_percent ?? 101) > 100}
            />
            <dl className="grid gap-1 text-sm">
              <Row label={`Opłata to ${pct(budget.monthly.share_percent)} miesięcznego budżetu „${info.label}”`} />
              <Row label="Udział w miesięcznym dochodzie" value={pct(budget.monthly.income_percent)} />
            </dl>
          </section>
        )}

        <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Jak to liczymy</summary>
          <div className="mt-2 grid gap-1.5 text-muted-foreground">
            <p>Budżet kategorii = miesięczny dochód netto × procent kategorii ({num(budget.percentage, 1)}%).</p>
            <p>Dostępne = budżet kategorii − wydane w tym miesiącu. Po zakupie: (wydane + cena) / budżet kategorii.</p>
            <p>Czas oszczędzania = (cena − już odłożone) / miesięczna wpłata (domyślnie cały budżet kategorii).</p>
            <p>
              Ostrzeżenia to proste, jawne reguły na Twoich założeniach (procenty i wydatki z{" "}
              <Link href="/budget" className="text-primary underline">
                planu budżetu
              </Link>
              ). To pomoc w decyzji, a nie porada finansowa.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/60 px-1 py-2.5">
      <div className={cn("text-sm font-semibold tabular-nums sm:text-base", negative && "text-destructive")}>{value}</div>
      <div className="text-[11px] text-muted-foreground sm:text-xs">{label}</div>
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value?: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      {value && (
        <dd className="shrink-0 font-medium tabular-nums" data-testid={testId}>
          {value}
        </dd>
      )}
    </div>
  );
}

/** Pasek: wydane (szare) + ten zakup (zielony, a po przekroczeniu czerwony); 100% = budżet kategorii. */
function UsageBar({
  label,
  spent,
  add,
  budget,
  percent,
  over,
}: {
  label: string;
  spent: number;
  add: number;
  budget: number;
  percent: number | null;
  over: boolean;
}) {
  const total = Math.max(budget, spent + add, 1);
  const spentW = Math.min(100, (spent / total) * 100);
  const addW = Math.min(100 - spentW, (add / total) * 100);
  const budgetMark = (budget / total) * 100;
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={cn("font-medium tabular-nums", over && "text-destructive")} data-testid="usage-percent">
          {percent != null ? `${num(percent, 0)}%` : "brak budżetu"}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${percent != null ? num(percent, 0) + "%" : "brak budżetu"}`}
        className="relative h-3 overflow-hidden rounded-full bg-muted"
      >
        <div className="absolute inset-y-0 left-0 bg-muted-foreground/40" style={{ width: `${spentW}%` }} />
        <div
          className={cn("absolute inset-y-0", over ? "bg-destructive" : "bg-primary")}
          style={{ left: `${spentW}%`, width: `${addW}%` }}
        />
        {over && budgetMark < 100 && (
          <div className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${budgetMark}%` }} title="Koniec budżetu kategorii" />
        )}
      </div>
    </div>
  );
}
