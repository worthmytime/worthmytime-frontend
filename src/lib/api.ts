export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001/api/v1";

export type Frequency = "ONE_TIME" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type CalcType = "SIMPLE" | "RECURRING" | "TCO";
export type Category = "NEEDS" | "FUTURE" | "GOALS" | "FUN";

/** Kredyt lub pożyczka w trakcie spłaty. Rata liczy się automatycznie do kategorii NEEDS. */
export interface LoanIn {
  /** identyfikator z serwera (po zapisie budżetu zmienia się) */
  id?: string;
  name: string;
  installment_amount: number;
  /** Liczba rat do spłacenia; pomijana, gdy podano datę końca (wtedy liczy się sama). */
  installments_left?: number | null;
  loan_amount?: number | null;
  start_date?: string | null; // YYYY-MM-DD, początek okresu spłaty
  end_date?: string | null; // YYYY-MM-DD, koniec okresu spłaty
  payment_day?: number | null; // dzień miesiąca, w którym przypada rata (1-31)
}

/** Plan budżetu: procenty kategorii (suma 100), wydatki w bieżącym miesiącu i kredyty. */
export interface BudgetPlan {
  percentages: Record<Category, number>;
  spent: Record<Category, number>;
  loans: LoanIn[];
  /** Przenoszenie niewykorzystanych środków kategorii na kolejny miesiąc (tylko konto; brak pola = bez zmian). */
  rollover?: Record<Category, boolean>;
}

export interface Expense {
  id: string;
  category: Category;
  amount: number;
  note: string | null;
  spent_on: string; // YYYY-MM-DD
  /**
   * pochodzenie wpisu: RECURRING (stały wydatek), LOAN (opłacona rata), IMPORT (import z banku),
   * WISH (zakup z listy życzeń), GOAL (wpłata na cel); brak = wpis ręczny
   */
  source_type?: "RECURRING" | "LOAN" | "IMPORT" | "WISH" | "GOAL" | null;
  source_id?: string | null;
}

/** Stały wydatek: wpis w rejestrze powstaje automatycznie w dniu płatności co miesiąc. */
export interface RecurringExpense {
  id: string;
  name: string;
  category: Category;
  amount: number;
  day_of_month: number; // 1-31 (w krótszych miesiącach ostatni dzień)
  active: boolean;
  start_date: string; // YYYY-MM-DD
  /** tylko lokalnie (bez konta): do kiedy wpisy zostały już dopisane */
  generated_through?: string | null;
}

export type RecurringIn = Pick<RecurringExpense, "name" | "category" | "amount" | "day_of_month" | "active">;

/** Szablon szybkiego wydatku (np. kawa): jedno dotknięcie dopisuje wpis do rejestru. */
export interface ExpenseTemplate {
  id: string;
  name: string;
  category: Category;
  amount: number;
}

export type ExpenseTemplateIn = Omit<ExpenseTemplate, "id">;

export interface MonthSummary {
  month: string; // YYYY-MM
  totals: Record<Category, number>;
  total: number;
}

/** Kategoria w podsumowaniu miesiąca: budżet, wydane i porównanie z poprzednim miesiącem. */
export interface MonthReportCategory {
  category: Category;
  budget: number;
  spent: number;
  available: number;
  usage_percent: number | null;
  previous: number;
  change: number;
  change_percent: number | null; // null, gdy miesiąc wcześniej nie było wydatków
}

/** Podsumowanie miesiąca z `GET /reports/month`. */
export interface MonthReport {
  month: string; // YYYY-MM
  previous_month: string;
  currency: string;
  monthly_income: number;
  categories: MonthReportCategory[];
  total_spent: number;
  previous: number;
  change: number;
  change_percent: number | null;
  /** future: wpisy w kategorii Przyszłość; unspent: dochód minus wszystkie wydatki (nie mniej niż 0) */
  saved: { future: number; unspent: number; /** wpłaty na cele minus wypłaty w tym miesiącu */ goals?: number };
  /** wydatki uznaniowe (Cele i Przyjemności) i czas pracy, który na nie poszedł */
  discretionary: { spent: number; work_hours: number | null };
  largest_expense: { id: string; category: Category; amount: number; note: string | null; spent_on: string } | null;
  entries: number;
}

/** Jeden import wyciągu w historii zdarzeń (`GET /imports`); cofnięcie usuwa wpisy, które dopisał. */
export interface ImportBatch {
  id: string;
  /** nazwa pliku z rozszerzeniem; null dla importu bez podanej nazwy */
  file_name: string | null;
  imported_at: string; // data i godzina importu (ISO)
  created: number;
  skipped: number;
  total: number;
  /** wpisy z tego importu, które są jeszcze w rejestrze */
  remaining: number;
  undone_at: string | null;
}

/** Wywiad o sytuacji życiowej (`GET/PUT /profile/context`); null = brak odpowiedzi. Kontekst dla podpowiedzi Jev. */
export interface LifeContext {
  housing: "WITH_PARENTS" | "RENT" | "OWN_MORTGAGE" | "OWN" | "OTHER" | null;
  household_size: number | null;
  children: number | null;
  car: "NONE" | "OWN" | "FINANCED" | null;
  car_age_years: number | null;
  commute: "CAR" | "PUBLIC" | "BIKE_WALK" | "NONE" | null;
  work_mode: "REMOTE" | "HYBRID" | "ONSITE" | "NOT_WORKING" | null;
  employment: "EMPLOYEE" | "SELF_EMPLOYED" | "STUDENT" | "RETIRED" | "OTHER" | null;
  phone_age_years: number | null;
  computer_age_years: number | null;
  has_emergency_fund: boolean | null;
  has_pets: boolean | null;
  notes: string | null;
}

export interface LifeContextState {
  context: LifeContext;
  /** zdania, którymi opisujemy użytkownika Jev */
  summary: string[];
  filled: boolean;
}

export interface WishlistItem {
  id: string;
  name: string;
  price: number;
  category: Category | null;
  cooldown_days: number;
  status: "WAITING" | "BOUGHT" | "DROPPED";
  created_at: string;
  decided_at: string | null;
  ready_at: string;
  days_left: number;
  ready: boolean;
  work: WorkTime | null;
}

export interface WishlistStats {
  dropped_count: number;
  dropped_total: number;
  dropped_hours: number;
  waiting_count: number;
  waiting_total: number;
  ready_count: number;
}

/** Wpłata na cel (kwota dodatnia) albo wypłata (ujemna) z historii celu. */
export interface GoalDeposit {
  id: string;
  amount: number;
  deposited_on: string; // YYYY-MM-DD
  /** wpłata ma powiązany wpis w rejestrze wydatków */
  in_ledger: boolean;
}

export interface SavingsGoal {
  id: string;
  name: string;
  category: Category | null;
  /** Wpłata faktycznie użyta w obliczeniach: własna albo maksimum z kategorii. */
  effective_contribution: number | null;
  max_monthly_contribution: number | null;
  contribution_source: "USER" | "CATEGORY_AVAILABLE" | null;
  contribution_exceeds: boolean;
  target_amount: number;
  saved_amount: number;
  monthly_contribution: number | null;
  target_date: string | null;
  remaining: number;
  percent: number;
  completed: boolean;
  months_to_goal: number | null;
  months_to_goal_full: number | null;
  eta: string | null;
  required_monthly: number | null;
  on_track: boolean | null;
  work_hours_remaining: number | null;
}

export interface BudgetState extends BudgetPlan {
  // `spent`: wydane w bieżącym miesiącu w kategoriach = suma wpisów z rejestru wydatków (nie edytuje się ich tutaj)
  monthly_loans: number;
  loans_income_percent: number | null;
  last_installment_in_months: number;
  /** budżet kategorii razem ze środkami przeniesionymi z poprzednich miesięcy */
  amounts: Record<Category, number> | null;
  available: Record<Category, number> | null;
  /** środki przeniesione na bieżący miesiąc w kategoriach z włączonym przenoszeniem */
  rollover_amounts?: Record<Category, number>;
  monthly_income: number | null;
  total_spent: number;
  is_custom: boolean;
}

export type WarningLevel = "critical" | "warning" | "info";

export interface BudgetWarning {
  code:
    | "CATEGORY_BUDGET_EXCEEDED"
    | "MONTHLY_COST_EXCEEDS_AVAILABLE"
    | "CATEGORY_BUDGET_TIGHT"
    | "BUDGET_DEFICIT"
    | "LOANS_EXCEED_NEEDS_BUDGET"
    | "CONTRIBUTION_EXCEEDS_AVAILABLE"
    | "NO_FREE_BUDGET"
    | "HIGHER_PRIORITY_AT_RISK"
    | "NO_BUDGET_DATA";
  level: WarningLevel;
  params: Record<string, number | string | null>;
}

export interface BudgetAnalysis {
  category: Category;
  priority: string;
  percentage: number;
  category_budget: number;
  spent: number;
  available: number;
  usage_percent: number | null;
  is_custom: boolean;
  fits_budget: boolean;
  /** Raty kredytów i pożyczek (wymagalne zobowiązania); null gdy brak kredytów. */
  obligations: {
    monthly_installments: number;
    loans_count: number;
    income_percent: number | null;
    last_installment_in_months: number;
    included_in_category: boolean;
  } | null;
  upfront: {
    cost: number;
    projected_spent: number;
    projected_usage_percent: number | null;
    purchase_share_percent: number | null;
    coverage_ratio: number | null;
    months_to_goal: number | null;
    months_to_goal_full: number | null;
    monthly_contribution: number;
    /** Ile maksymalnie można miesięcznie przeznaczyć na ten wydatek: wolne środki kategorii w tym miesiącu. */
    max_monthly_contribution: number;
    contribution_source: "USER" | "CATEGORY_AVAILABLE";
    already_saved: number;
    income_percent: number | null;
  } | null;
  monthly: {
    cost: number;
    projected_spent: number;
    projected_usage_percent: number | null;
    share_percent: number | null;
    income_percent: number | null;
  } | null;
  warnings: BudgetWarning[];
}

export interface Profile {
  currency: string;
  monthly_income: number | null;
  hourly_rate: number | null;
  hours_per_day: number;
  days_per_week: number;
  /** Realna stawka: dojazd i koszty związane z pracą (opcjonalnie). */
  commute_minutes_per_day?: number;
  work_costs_monthly?: number;
  rate_mode?: "NOMINAL" | "REAL";
  effective_hourly_rate?: number | null;
  nominal_hourly_rate?: number | null;
  real_hourly_rate?: number | null;
  hours_per_month?: number;
}

export interface CostIn {
  name: string;
  amount: number;
  frequency: Frequency;
}

export interface CalculationIn {
  name: string;
  type: CalcType;
  purchase_price: number;
  ownership_years: number | null;
  resale_value: number;
  costs: CostIn[];
  expected_uses?: number | null;
  category?: Category | null;
  already_saved?: number;
  monthly_contribution?: number | null;
}

export interface WorkTime {
  hours: number;
  hours_part: number;
  minutes_part: number;
  working_days: number;
  working_weeks: number;
  working_months: number;
  working_years: number;
  /** Jaka część miesięcznej wypłaty pochłania wydatek (100 = cała). Brak w widoku publicznym. */
  income_percent?: number;
}

export interface Result {
  name: string;
  type: CalcType;
  currency?: string;
  total_cost: number;
  breakdown: { name: string; amount: number; frequency?: Frequency }[];
  hourly_rate?: number;
  work: WorkTime;
  life_cost: { years: number; per_day: number; per_week: number; per_month: number } | null;
  /** Koszt jednego użycia (gdy podano expected_uses). */
  per_use?: { uses: number; cost: number; work_minutes: number } | null;
  horizons?: { label: string; years: number; cost: number; work: WorkTime }[];
  summary?: { years: number; working_days: number };
  /** Analiza planu budżetowego - tylko gdy wybrano kategorię. */
  budget?: BudgetAnalysis | null;
}

export interface Comparison {
  currency: string;
  a: Result;
  b: Result;
  difference: { cost: number; hours: number; working_days: number };
}

export interface SavedCalculation {
  id: string;
  public_id: string | null;
  name: string;
  type: CalcType;
  currency: string;
  created_at: string;
  input: CalculationIn;
  result: Result;
}

export interface Dashboard {
  currency: string;
  count: number;
  total_value: number;
  total_hours: number;
  total_working_days: number;
  largest_expense: { id: string; name: string; total_cost: number; hours: number } | null;
  recurring: { id: string; name: string; yearly_cost: number; yearly_hours: number }[];
  recurring_yearly_total: number;
  recent: SavedCalculation[];
}

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: FieldError[] = [],
  ) {
    super(message);
  }
}

// Sesja siedzi w cookie `wmt_session` (HttpOnly, niedostępne dla skryptów). Cookie `wmt_csrf` jest odczytywalne:
// służy jako znacznik "jest sesja" i jako token CSRF odsyłany w nagłówku przy żądaniach zmieniających dane.
const CSRF_COOKIE = "wmt_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const LEGACY_TOKEN_KEY = "wmt_token"; // dawniej token trzymaliśmy w localStorage

export const csrfToken = (): string | null => {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1)) : null;
};
export const hasSession = () => csrfToken() != null;

/** Token z localStorage z poprzedniej wersji (do jednorazowej wymiany na cookie). */
export const legacyToken = () => (typeof window === "undefined" ? null : window.localStorage.getItem(LEGACY_TOKEN_KEY));
export const clearLegacyToken = () => {
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {}
};

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; /** token Bearer tylko do wymiany na cookie */ bearer?: string } = {},
): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  const csrf = method === "GET" ? null : csrfToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.bearer ? { Authorization: `Bearer ${init.bearer}` } : {}),
      ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Błąd ${res.status}`, res.status, data.errors ?? []);
  return data as T;
}
