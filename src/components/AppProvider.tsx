"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearLegacyToken, hasSession, legacyToken, type BudgetPlan, type BudgetState, type Expense, type ExpenseTemplate, type Profile, type RecurringExpense } from "@/lib/api";
import { effectivePlan, readLocalLedger, writeLocalLedger } from "@/lib/ledger";
import { materialize, readLocalRecurring, writeLocalRecurring } from "@/lib/recurring";
import { readLocalTemplates, writeLocalTemplates } from "@/lib/templates";

const LOCAL_PROFILE_KEY = "wmt_profile";
const LOCAL_BUDGET_KEY = "wmt_budget";

interface Ctx {
  ready: boolean;
  email: string | null;
  loggedIn: boolean;
  profile: Profile | null; // null = niewypełniony
  /** Ciało `profile` dla żądań bezstanowych; zalogowany używa profilu z serwera. */
  profileForRequest: Profile | undefined;
  /** Efektywny miesięczny dochód netto (z dochodu albo stawki godzinowej); null gdy profil niewypełniony. */
  monthlyIncome: number | null;
  /** Plan budżetu; null = nieustawiony (backend liczy wtedy z domyślnego 50/25/15/10). */
  budget: BudgetPlan | null;
  /** Budżet do wysłania w żądaniu bezstanowym; zalogowany używa budżetu z serwera. */
  budgetForRequest: BudgetPlan | undefined;
  saveBudget: (b: BudgetPlan) => Promise<void>;
  /** Rejestr wydatków anonimowego użytkownika (zalogowany używa API). */
  localLedger: Expense[];
  setLocalLedger: (items: Expense[]) => void;
  /** Szablony stałych wydatków anonimowego użytkownika (zalogowany używa API). */
  localRecurring: RecurringExpense[];
  setLocalRecurring: (items: RecurringExpense[]) => void;
  /** Szablony szybkich wydatków anonimowego użytkownika (zalogowany używa API). */
  localTemplates: ExpenseTemplate[];
  setLocalTemplates: (items: ExpenseTemplate[]) => void;
  saveProfile: (p: Profile) => Promise<void>;
  login: (email: string, password: string, register?: boolean) => Promise<void>;
  logout: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp poza AppProvider");
  return c;
};

const hasRate = (p: Profile | null) => !!p && (p.monthly_income != null || p.hourly_rate != null);

function readLocalBudget(): BudgetPlan | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_BUDGET_KEY);
    if (!raw) return null;
    // starsze zapisy nie mają kredytów, a ręczne "wydane" z dawnej wersji ignorujemy (liczy rejestr wydatków)
    const stored = { loans: [], ...JSON.parse(raw) };
    stored.spent = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };
    return stored;
  } catch {
    return null;
  }
}

const toPlan = (b: BudgetState): BudgetPlan | null =>
  b.is_custom || b.loans.length > 0
    ? { percentages: b.percentages, spent: b.spent, loans: b.loans, ...(b.rollover ? { rollover: b.rollover } : {}) }
    : null;


export function effectiveMonthlyIncome(p: Profile | null): number | null {
  if (!p) return null;
  const hoursPerMonth = (p.hours_per_day * p.days_per_week * 52) / 12;
  if (p.hourly_rate != null) return p.hourly_rate * hoursPerMonth;
  return p.monthly_income ?? null;
}

/** Plan dla żądania anonimowego: procenty i kredyty z ustawień + "wydane" z rejestru; bez budżetu domyślny podział. */
function anonymousPlan(budget: BudgetPlan | null, ledger: Expense[]): BudgetPlan | undefined {
  if (!budget && ledger.length === 0) return undefined;
  const base = budget ?? {
    percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
    spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
    loans: [],
  };
  return effectivePlan(base, ledger);
}
function readLocalProfile(): Profile | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [budget, setBudget] = useState<BudgetPlan | null>(null);
  const [localLedger, setLocalLedgerState] = useState<Expense[]>([]);
  const [localRecurring, setLocalRecurringState] = useState<RecurringExpense[]>([]);
  const [localTemplates, setLocalTemplatesState] = useState<ExpenseTemplate[]>([]);

  useEffect(() => {
    (async () => {
      const legacy = legacyToken();
      if (hasSession() || legacy) {
        try {
          if (legacy) {
            // jednorazowa migracja: token z localStorage wymieniamy na cookie sesji i usuwamy z przeglądarki
            try {
              await api("/auth/session", { method: "POST", bearer: legacy });
            } catch {
              // wymiana się nie udała (token wygasł albo stary backend): niżej sprawdzimy, czy jest już sesja w cookie
            } finally {
              clearLegacyToken();
            }
          }
          const me = await api<{ email: string; profile: Profile }>("/auth/me");
          setEmail(me.email);
          setProfile(hasRate(me.profile) ? me.profile : null);
          setBudget(toPlan(await api<BudgetState>("/budget")));
          return;
        } catch {
          void api("/auth/logout", { method: "POST" }).catch(() => {}); // sesja wygasła: wyczyść stare cookie
        }
      }
      setProfile(readLocalProfile());
      setBudget(readLocalBudget());
      // stałe wydatki: brakujące wpisy do dziś dopisują się do lokalnego rejestru przy wejściu do aplikacji
      const merged = materialize(readLocalRecurring(), readLocalLedger());
      if (merged.created) writeLocalLedger(merged.ledger);
      writeLocalRecurring(merged.templates);
      setLocalLedgerState(merged.ledger);
      setLocalRecurringState(merged.templates);
      setLocalTemplatesState(readLocalTemplates());
    })().finally(() => setReady(true));
  }, []);

  const saveProfile = useCallback(
    async (p: Profile) => {
      if (email) {
        setProfile(await api<Profile>("/profile", { method: "PUT", body: p }));
      } else {
        window.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(p));
        setProfile(p);
      }
    },
    [email],
  );

  const saveBudget = useCallback(
    async (b: BudgetPlan) => {
      if (email) {
        setBudget(toPlan(await api<BudgetState>("/budget", { method: "PUT", body: b })));
      } else {
        window.localStorage.setItem(LOCAL_BUDGET_KEY, JSON.stringify(b));
        setBudget(b);
      }
    },
    [email],
  );

  const login = useCallback(async (mail: string, password: string, register = false) => {
    const res = await api<{ token: string; profile: Profile }>(register ? "/auth/register" : "/auth/login", {
      body: { email: mail, password },
    });
    // cookie sesji ustawia serwer; token z treści odpowiedzi nigdzie nie zapisujemy
    setEmail(mail.toLowerCase());
    // konto bez profilu: przenieś profil anonimowy na serwer
    let next: Profile | null = hasRate(res.profile) ? res.profile : null;
    if (!next) {
      const local = readLocalProfile();
      if (local) {
        try {
          next = await api<Profile>("/profile", { method: "PUT", body: local });
        } catch {}
      }
    }
    setProfile(next);
    try {
      let serverBudget = toPlan(await api<BudgetState>("/budget"));
      const local = readLocalBudget();
      // konto bez budżetu: przenieś budżet anonimowy na serwer
      if (!serverBudget && local) serverBudget = toPlan(await api<BudgetState>("/budget", { method: "PUT", body: local }));
      setBudget(serverBudget);
    } catch {}
  }, []);

  const setLocalLedger = useCallback((items: Expense[]) => {
    writeLocalLedger(items);
    setLocalLedgerState(items);
  }, []);

  const setLocalRecurring = useCallback((items: RecurringExpense[]) => {
    writeLocalRecurring(items);
    setLocalRecurringState(items);
  }, []);

  const setLocalTemplates = useCallback((items: ExpenseTemplate[]) => {
    writeLocalTemplates(items);
    setLocalTemplatesState(items);
  }, []);

  const logout = useCallback(() => {
    void api("/auth/logout", { method: "POST" }).catch(() => {});
    setEmail(null);
    setProfile(readLocalProfile());
    setBudget(readLocalBudget());
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      email,
      loggedIn: !!email,
      profile,
      profileForRequest: email ? undefined : (profile ?? undefined),
      monthlyIncome: effectiveMonthlyIncome(profile),
      budget,
      budgetForRequest: email ? undefined : anonymousPlan(budget, localLedger),
      localLedger,
      setLocalLedger,
      localRecurring,
      setLocalRecurring,
      localTemplates,
      setLocalTemplates,
      saveBudget,
      saveProfile,
      login,
      logout,
    }),
    [ready, email, profile, budget, localLedger, setLocalLedger, localRecurring, setLocalRecurring, localTemplates, setLocalTemplates, saveProfile, saveBudget, login, logout],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
