import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { z } from "zod";
import { ApiError, type BudgetPlan, type CalcType, type CalculationIn, type Category, type Frequency, type LoanIn, type Profile } from "./api";

/**
 * Liczba z pola tekstowego w polskim zapisie: "1 299,99" -> 1299.99. Spacje (także niełamiące) grupują tysiące,
 * przecinek albo kropka oddziela grosze. Puste pole i tekst, który nie jest liczbą, dają NaN.
 */
export const parseNumber = (value: string): number => {
  const s = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  return s === "" ? NaN : Number(s);
};

/** Liczba do pola tekstowego: z przecinkiem dziesiętnym, tak jak wpisuje ją użytkownik. */
export const numberToInput = (n: number | null | undefined): string => (n == null ? "" : String(n).replace(".", ","));

/** Pole liczbowe z inputu tekstowego: "" -> null, zapis polski ("1 299,99") dozwolony. */
export const optionalNumber = z
  .string()
  .transform((s) => (s.trim() === "" ? null : parseNumber(s)))
  .refine((n) => n === null || Number.isFinite(n), "Podaj liczbę, np. 1 299,99");

export const requiredNumber = (label: string) =>
  z
    .string()
    .transform((s) => parseNumber(s))
    .refine((n) => Number.isFinite(n), `${label}: podaj liczbę, np. 1 299,99`);

export const FREQUENCIES = ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const satisfies readonly Frequency[];
export const CALC_TYPES = ["SIMPLE", "TCO", "RECURRING"] as const satisfies readonly CalcType[];

export const profileSchema = z
  .object({
    currency: z.string().trim().length(3, "Kod waluty ma 3 litery"),
    monthly_income: optionalNumber.refine((n) => n === null || n > 0, "Musi być większe od zera"),
    hourly_rate: optionalNumber.refine((n) => n === null || n > 0, "Musi być większe od zera"),
    hours_per_day: requiredNumber("Godziny").refine((n) => n > 0 && n <= 24, "Od 0,5 do 24 godzin"),
    days_per_week: requiredNumber("Dni").refine((n) => n > 0 && n <= 7, "Od 1 do 7 dni"),
    commute_minutes_per_day: optionalNumber.refine((n) => n === null || (n >= 0 && n <= 600), "Od 0 do 600 minut"),
    work_costs_monthly: optionalNumber.refine((n) => n === null || n >= 0, "Nie mogą być ujemne"),
    rate_mode: z.enum(["NOMINAL", "REAL"]),
  })
  .superRefine((v, ctx) => {
    if (v.monthly_income === null && v.hourly_rate === null) {
      ctx.addIssue({ code: "custom", path: ["monthly_income"], message: "Podaj dochód albo stawkę godzinową" });
    }
  });

export type ProfileFormIn = z.input<typeof profileSchema>;
export type ProfileFormOut = z.output<typeof profileSchema>;

export const profileToForm = (p: Profile | null): ProfileFormIn => ({
  currency: p?.currency ?? "PLN",
  monthly_income: p?.monthly_income?.toString() ?? "",
  hourly_rate: p?.hourly_rate?.toString() ?? "",
  hours_per_day: String(p?.hours_per_day ?? 8),
  days_per_week: String(p?.days_per_week ?? 5),
  commute_minutes_per_day: p?.commute_minutes_per_day ? String(p.commute_minutes_per_day) : "",
  work_costs_monthly: p?.work_costs_monthly ? String(p.work_costs_monthly) : "",
  rate_mode: p?.rate_mode ?? "NOMINAL",
});

export const profileFromForm = (v: ProfileFormOut): Profile => ({
  currency: v.currency.toUpperCase(),
  monthly_income: v.monthly_income,
  hourly_rate: v.hourly_rate,
  hours_per_day: v.hours_per_day,
  days_per_week: v.days_per_week,
  commute_minutes_per_day: v.commute_minutes_per_day ?? 0,
  work_costs_monthly: v.work_costs_monthly ?? 0,
  rate_mode: v.rate_mode,
});

export const BUDGET_CATEGORIES = ["NEEDS", "FUTURE", "GOALS", "FUN"] as const satisfies readonly Category[];

export const calculationSchema = z
  .object({
    name: z.string().trim().min(1, "Podaj nazwę").max(200),
    type: z.enum(CALC_TYPES),
    purchase_price: optionalNumber.refine((n) => n === null || n >= 0, "Nie może być ujemna"),
    ownership_years: optionalNumber.refine((n) => n === null || (n > 0 && n <= 100), "Od 0,1 do 100 lat"),
    resale_value: optionalNumber.refine((n) => n === null || n >= 0, "Nie może być ujemna"),
    expected_uses: optionalNumber.refine((n) => n === null || (Number.isInteger(n) && n >= 1), "Liczba całkowita od 1"),
    category: z.enum(["", ...BUDGET_CATEGORIES]),
    already_saved: optionalNumber.refine((n) => n === null || n >= 0, "Nie może być ujemna"),
    monthly_contribution: optionalNumber.refine((n) => n === null || n > 0, "Musi być większa od zera"),
    costs: z.array(
      z.object({
        name: z.string().trim().min(1, "Podaj nazwę").max(200),
        amount: requiredNumber("Kwota").refine((n) => n >= 0, "Nie może być ujemna"),
        frequency: z.enum(FREQUENCIES),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "RECURRING" && !v.purchase_price) {
      ctx.addIssue({ code: "custom", path: ["purchase_price"], message: "Podaj cenę" });
    }
    if (v.type === "TCO" && v.ownership_years === null) {
      ctx.addIssue({ code: "custom", path: ["ownership_years"], message: "Podaj okres użytkowania" });
    }
    if (v.type === "RECURRING" && v.costs.length === 0) {
      ctx.addIssue({ code: "custom", path: ["costs"], message: "Dodaj co najmniej jedną opłatę" });
    }
  });

export type CalcFormIn = z.input<typeof calculationSchema>;
export type CalcFormOut = z.output<typeof calculationSchema>;

export const emptyCalcForm = (type: CalcType = "SIMPLE", name = ""): CalcFormIn => ({
  name,
  type,
  purchase_price: "",
  ownership_years: type === "TCO" ? "5" : "",
  resale_value: "",
  expected_uses: "",
  category: "",
  already_saved: "",
  monthly_contribution: "",
  costs: type === "RECURRING" ? [{ name: "Subskrypcja", amount: "", frequency: "MONTHLY" }] : [],
});

export const calcToForm = (c: CalculationIn): CalcFormIn => ({
  name: c.name,
  type: c.type,
  purchase_price: c.purchase_price ? String(c.purchase_price) : "",
  ownership_years: c.ownership_years != null ? String(c.ownership_years) : "",
  resale_value: c.resale_value ? String(c.resale_value) : "",
  expected_uses: c.expected_uses ? String(c.expected_uses) : "",
  category: c.category ?? "",
  already_saved: c.already_saved ? String(c.already_saved) : "",
  monthly_contribution: c.monthly_contribution ? String(c.monthly_contribution) : "",
  costs: c.costs.map((x) => ({ name: x.name, amount: String(x.amount), frequency: x.frequency })),
});

export const calcFromForm = (v: CalcFormOut): CalculationIn => ({
  name: v.name,
  type: v.type,
  purchase_price: v.purchase_price ?? 0,
  ownership_years: v.type === "RECURRING" ? null : v.ownership_years,
  resale_value: v.type === "TCO" ? (v.resale_value ?? 0) : 0,
  costs: v.type === "SIMPLE" ? [] : v.costs,
  expected_uses: v.type === "RECURRING" ? null : v.expected_uses,
  category: v.category || null,
  already_saved: v.category && v.type !== "RECURRING" ? (v.already_saved ?? 0) : 0,
  monthly_contribution: v.category && v.type !== "RECURRING" ? v.monthly_contribution : null,
});

// --- budżet ---------------------------------------------------------------------------------

/** Jeden kredyt lub pożyczka w formularzu (karta "Kredyty i pożyczki" na stronie Wydatki). */
export const loanSchema = z.object({
  // identyfikator kredytu z serwera ("" dla nowego): dzięki niemu zapis nie zrywa powiązania z opłaconymi ratami
  loan_id: z.string(),
  name: z.string().trim().min(1, "Podaj nazwę").max(100),
  installment_amount: requiredNumber("Rata").refine((n) => n > 0, "Rata musi być większa od zera"),
  installments_left: optionalNumber.refine(
    (n) => n === null || (Number.isInteger(n) && n >= 1 && n <= 600),
    "Liczba rat: całkowita, od 1 do 600",
  ),
  loan_amount: optionalNumber.refine((n) => n === null || n >= 0, "Nie może być ujemna"),
  start_date: z.string(),
  end_date: z.string(),
  payment_day: optionalNumber.refine(
    (n) => n === null || (Number.isInteger(n) && n >= 1 && n <= 31),
    "Dzień miesiąca od 1 do 31",
  ),
})
.superRefine((l, ctx) => {
  if (l.installments_left === null && !l.end_date) {
    ctx.addIssue({ code: "custom", path: ["installments_left"], message: "Podaj liczbę rat albo datę końca spłaty" });
  }
  if (l.start_date && l.end_date && l.end_date < l.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "Koniec spłaty nie może być przed początkiem" });
  }
});

export const loansSchema = z.object({ loans: z.array(loanSchema) });
export type LoansFormIn = z.input<typeof loansSchema>;
export type LoansFormOut = z.output<typeof loansSchema>;

export const budgetSchema = z
  .object({
    pct_NEEDS: requiredNumber("Potrzeby").refine((n) => n >= 0 && n <= 100, "Od 0 do 100"),
    pct_FUTURE: requiredNumber("Przyszłość").refine((n) => n >= 0 && n <= 100, "Od 0 do 100"),
    pct_GOALS: requiredNumber("Cele").refine((n) => n >= 0 && n <= 100, "Od 0 do 100"),
    pct_FUN: requiredNumber("Przyjemności").refine((n) => n >= 0 && n <= 100, "Od 0 do 100"),
    // przenoszenie niewykorzystanych środków na kolejny miesiąc (tylko konto)
    rollover_NEEDS: z.boolean(),
    rollover_FUTURE: z.boolean(),
    rollover_GOALS: z.boolean(),
    rollover_FUN: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const sum = v.pct_NEEDS + v.pct_FUTURE + v.pct_GOALS + v.pct_FUN;
    if (Math.abs(sum - 100) > 0.01) {
      ctx.addIssue({ code: "custom", path: ["pct_NEEDS"], message: `Procenty muszą sumować się do 100 (teraz ${Math.round(sum * 100) / 100})` });
    }
  });

export type BudgetFormIn = z.input<typeof budgetSchema>;
export type BudgetFormOut = z.output<typeof budgetSchema>;

export const DEFAULT_BUDGET: BudgetPlan = {
  percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
  spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
  loans: [],
};

export const budgetToForm = (b: BudgetPlan | null): BudgetFormIn => {
  const p = b ?? DEFAULT_BUDGET;
  return {
    pct_NEEDS: String(p.percentages.NEEDS),
    pct_FUTURE: String(p.percentages.FUTURE),
    pct_GOALS: String(p.percentages.GOALS),
    pct_FUN: String(p.percentages.FUN),
    rollover_NEEDS: !!p.rollover?.NEEDS,
    rollover_FUTURE: !!p.rollover?.FUTURE,
    rollover_GOALS: !!p.rollover?.GOALS,
    rollover_FUN: !!p.rollover?.FUN,
  };
};

/**
 * Podział dochodu z formularza Budżetu (bez kredytów: te mają własną kartę na stronie Wydatki).
 * `withRollover`: ustawienie przenoszenia środków wysyłamy tylko z konta (bez konta nie ma historii miesięcy na serwerze).
 */
export const budgetFromForm = (v: BudgetFormOut, withRollover = false): Omit<BudgetPlan, "loans"> => ({
  ...(withRollover ? { rollover: { NEEDS: v.rollover_NEEDS, FUTURE: v.rollover_FUTURE, GOALS: v.rollover_GOALS, FUN: v.rollover_FUN } } : {}),
  percentages: { NEEDS: v.pct_NEEDS, FUTURE: v.pct_FUTURE, GOALS: v.pct_GOALS, FUN: v.pct_FUN },
  // "wydane" w kategoriach liczy rejestr wydatków - formularz budżetu ich nie ustawia
  spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
});

export const loansToForm = (loans: LoanIn[] | undefined): LoansFormIn => ({
  loans: (loans ?? []).map((l) => ({
    loan_id: l.id ?? "",
    name: l.name,
    installment_amount: numberToInput(l.installment_amount),
    // z datą końca liczba rat jest wyliczana na bieżąco - nie wpisujemy zapisanej migawki do formularza
    installments_left: l.installments_left && !l.end_date ? String(l.installments_left) : "",
    loan_amount: l.loan_amount ? numberToInput(l.loan_amount) : "",
    start_date: l.start_date ?? "",
    end_date: l.end_date ?? "",
    payment_day: l.payment_day ? String(l.payment_day) : "",
  })),
});

export const loansFromForm = (v: LoansFormOut): LoanIn[] =>
  v.loans.map((l) => ({
    ...(l.loan_id ? { id: l.loan_id } : {}),
    name: l.name,
    installment_amount: l.installment_amount,
    installments_left: l.installments_left,
    loan_amount: l.loan_amount,
    start_date: l.start_date || null,
    end_date: l.end_date || null,
    payment_day: l.payment_day,
  }));

/**
 * Kredyty w kształcie do zapisu, gdy zmienia się tylko podział dochodu: identyfikator zostaje, a liczba rat
 * wyliczana z daty końca nie jest odsyłana (API liczy ją samo).
 */
export const loansForSave = (loans: LoanIn[] | undefined): LoanIn[] =>
  (loans ?? []).map((l) => ({
    ...(l.id ? { id: l.id } : {}),
    name: l.name,
    installment_amount: l.installment_amount,
    installments_left: l.end_date ? null : (l.installments_left ?? null),
    loan_amount: l.loan_amount ?? null,
    start_date: l.start_date ?? null,
    end_date: l.end_date ?? null,
    payment_day: l.payment_day ?? null,
  }));

/**
 * Przenosi błędy walidacji z API (422) na pola formularza.
 * Zwraca true, jeśli wszystkie błędy udało się przypisać do pól.
 */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): boolean {
  if (!(err instanceof ApiError) || err.status !== 422 || err.errors.length === 0) return false;
  let all = true;
  for (const e of err.errors) {
    const path = e.field.replace(/^(calculation|profile|budget|a|b)\./, "");
    if (path) setError(path as FieldPath<T>, { type: "server", message: e.message });
    else all = false;
  }
  return all;
}

export const errorMessage = (e: unknown, fallback = "Coś poszło nie tak") =>
  e instanceof Error ? e.message : fallback;
