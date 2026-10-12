"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type LifeContext, type LifeContextState } from "@/lib/api";
import { errorMessage } from "@/lib/forms";

const EMPTY: LifeContext = {
  housing: null,
  household_size: null,
  children: null,
  car: null,
  car_age_years: null,
  commute: null,
  work_mode: null,
  employment: null,
  phone_age_years: null,
  computer_age_years: null,
  has_emergency_fund: null,
  emergency_fund_months: null,
  saves_regularly: null,
  invests: null,
  has_pets: null,
  pets_description: null,
  regular_health_costs: null,
  does_sport: null,
  pays_for_education: null,
  custom: [],
  notes: null,
};

/** Tyle własnych kategorii przyjmuje API. */
const MAX_CUSTOM = 10;

type Options<T extends string> = [T, string][];

const HOUSING: Options<NonNullable<LifeContext["housing"]>> = [
  ["WITH_PARENTS", "Mieszkam z rodzicami"],
  ["RENT", "Wynajmuję"],
  ["OWN_MORTGAGE", "Własne, spłacam kredyt"],
  ["OWN", "Własne, bez kredytu"],
  ["OTHER", "Inaczej"],
];
const CAR: Options<NonNullable<LifeContext["car"]>> = [
  ["NONE", "Nie mam samochodu"],
  ["OWN", "Mam własny"],
  ["FINANCED", "Mam w leasingu lub na kredyt"],
];
const COMMUTE: Options<NonNullable<LifeContext["commute"]>> = [
  ["CAR", "Samochodem"],
  ["PUBLIC", "Komunikacją publiczną"],
  ["BIKE_WALK", "Pieszo lub rowerem"],
  ["NONE", "Nie dojeżdżam"],
];
const WORK_MODE: Options<NonNullable<LifeContext["work_mode"]>> = [
  ["REMOTE", "Zdalnie"],
  ["HYBRID", "Hybrydowo"],
  ["ONSITE", "Na miejscu"],
  ["NOT_WORKING", "Obecnie nie pracuję"],
];
const EMPLOYMENT: Options<NonNullable<LifeContext["employment"]>> = [
  ["EMPLOYEE", "Etat lub umowa"],
  ["SELF_EMPLOYED", "Własna działalność"],
  ["STUDENT", "Studiuję lub się uczę"],
  ["RETIRED", "Emerytura lub renta"],
  ["OTHER", "Inne"],
];

const selectClass = "h-11 w-full rounded-lg border border-input bg-background px-2 text-sm";

/** Liczba całkowita z pola albo null (puste pole = brak odpowiedzi); wartość przycinana do zakresu. */
const toInt = (value: string, min: number, max: number): number | null => {
  if (value.trim() === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

/**
 * Wywiad o sytuacji życiowej: mieszkanie, transport, praca, sprzęt, oszczędności, zwierzęta, zdrowie i rozwój
 * oraz własne kategorie użytkownika. Wszystkie pytania są opcjonalne;
 * odpowiedzi zapisujemy na koncie i przekazujemy Jev jako kontekst przy proponowaniu kategorii wydatków.
 */
export default function LifeContextCard() {
  const [answers, setAnswers] = useState<LifeContext | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<LifeContextState>("/profile/context")
      .then((r) => {
        if (cancelled) return;
        setAnswers({ ...EMPTY, ...r.context });
        setSummary(r.summary);
      })
      .catch(() => {
        if (!cancelled) setAnswers(EMPTY); // wywiad jest dodatkiem: gdy API go nie zna, pokazujemy pusty formularz
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!answers) return <Skeleton className="h-64 w-full" />;

  const set = <K extends keyof LifeContext>(key: K, value: LifeContext[K]) => setAnswers({ ...answers, [key]: value });
  const hasCar = answers.car === "OWN" || answers.car === "FINANCED";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!answers) return;
    setSaving(true);
    try {
      const body: LifeContext = {
        ...answers,
        car_age_years: hasCar ? answers.car_age_years : null,
        emergency_fund_months: answers.has_emergency_fund ? answers.emergency_fund_months : null,
        pets_description: answers.has_pets ? answers.pets_description?.trim() || null : null,
        // wiersz własnej kategorii bez nazwy albo opisu traktujemy jako niewypełniony
        custom: answers.custom.map((c) => ({ name: c.name.trim(), description: c.description.trim() })).filter((c) => c.name && c.description),
        notes: answers.notes?.trim() || null,
      };
      const r = await api<LifeContextState>("/profile/context", { method: "PUT", body });
      setAnswers({ ...EMPTY, ...r.context });
      setSummary(r.summary);
      toast.success("Wywiad zapisany");
    } catch (err) {
      toast.error(errorMessage(err, "Nie udało się zapisać wywiadu"));
    } finally {
      setSaving(false);
    }
  }

  /** Lista wyboru z odpowiedzią "nie podaję" (null). */
  const choice = <K extends "housing" | "car" | "commute" | "work_mode" | "employment">(key: K, label: string, options: Options<string>) => (
    <div className="grid gap-1.5">
      <label htmlFor={`life-${key}`} className="text-sm font-medium">
        {label}
      </label>
      <select id={`life-${key}`} className={selectClass} value={answers[key] ?? ""} onChange={(e) => set(key, (e.target.value || null) as LifeContext[K])}>
        <option value="">nie podaję</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );

  type YesNoKey = "has_emergency_fund" | "saves_regularly" | "invests" | "has_pets" | "regular_health_costs" | "does_sport" | "pays_for_education";

  const yesNo = (key: YesNoKey, label: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`life-${key}`} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={`life-${key}`}
        className={selectClass}
        value={answers[key] == null ? "" : answers[key] ? "yes" : "no"}
        onChange={(e) => set(key, e.target.value === "" ? null : e.target.value === "yes")}
      >
        <option value="">nie podaję</option>
        <option value="yes">Tak</option>
        <option value="no">Nie</option>
      </select>
    </div>
  );

  type NumberKey = "household_size" | "children" | "car_age_years" | "phone_age_years" | "computer_age_years" | "emergency_fund_months";

  const number = (key: NumberKey, label: string, min: number, max: number) => (
    <div className="grid gap-1.5">
      <label htmlFor={`life-${key}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`life-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className="h-11"
        value={answers[key] ?? ""}
        onChange={(e) => set(key, toInt(e.target.value, min, max))}
      />
    </div>
  );

  const group = "grid gap-4 rounded-xl border bg-muted/30 p-3";
  const legend = "px-1 text-sm font-medium";

  return (
    <Card data-testid="life-context-card">
      <CardHeader>
        <CardTitle className="text-lg">Twoja sytuacja</CardTitle>
        <CardDescription>
          Kilka pytań o to, jak żyjesz. Wszystkie są opcjonalne. Odpowiedzi zapisujemy na Twoim koncie i przekazujemy Jev (zewnętrznej usłudze AI)
          razem z opisem wydatku, żeby trafniej proponował kategorie.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <fieldset className={group}>
            <legend className={legend}>Mieszkanie</legend>
            {choice("housing", "Gdzie mieszkasz?", HOUSING)}
            <div className="grid grid-cols-2 gap-4">
              {number("household_size", "Osób w gospodarstwie", 1, 15)}
              {number("children", "Dzieci na utrzymaniu", 0, 12)}
            </div>
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Transport</legend>
            {choice("car", "Samochód", CAR)}
            {hasCar && number("car_age_years", "Wiek samochodu (lata)", 0, 60)}
            {choice("commute", "Jak dojeżdżasz do pracy?", COMMUTE)}
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Praca</legend>
            {choice("work_mode", "Jak pracujesz?", WORK_MODE)}
            {choice("employment", "Forma zatrudnienia", EMPLOYMENT)}
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Sprzęt</legend>
            <div className="grid grid-cols-2 gap-4">
              {number("phone_age_years", "Wiek telefonu (lata)", 0, 20)}
              {number("computer_age_years", "Wiek komputera (lata)", 0, 30)}
            </div>
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Oszczędności</legend>
            <div className="grid grid-cols-2 gap-4">
              {yesNo("has_emergency_fund", "Poduszka finansowa")}
              {answers.has_emergency_fund && number("emergency_fund_months", "Na ile miesięcy wydatków", 0, 120)}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {yesNo("saves_regularly", "Odkładasz regularnie?")}
              {yesNo("invests", "Inwestujesz?")}
            </div>
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Zwierzęta</legend>
            {yesNo("has_pets", "Masz zwierzęta domowe?")}
            {answers.has_pets && (
              <div className="grid gap-1.5">
                <label htmlFor="life-pets" className="text-sm font-medium">
                  Jakie? (opcjonalnie)
                </label>
                <Input
                  id="life-pets"
                  maxLength={100}
                  className="h-11"
                  placeholder="np. pies i dwa koty"
                  value={answers.pets_description ?? ""}
                  onChange={(e) => set("pets_description", e.target.value)}
                />
              </div>
            )}
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Zdrowie i rozwój</legend>
            {yesNo("regular_health_costs", "Stałe wydatki na leczenie lub leki")}
            <div className="grid grid-cols-2 gap-4">
              {yesNo("does_sport", "Regularny sport lub siłownia")}
              {yesNo("pays_for_education", "Płatna nauka lub kursy")}
            </div>
          </fieldset>

          <fieldset className={group} data-testid="life-custom">
            <legend className={legend}>Własne kategorie</legend>
            <p className="text-xs text-muted-foreground">
              Brakuje czegoś ważnego w Twoim życiu? Dopisz własną kategorię: krótką nazwę i opis, np. „Hobby” i „fotografia, co kilka miesięcy kupuję sprzęt”.
            </p>
            {answers.custom.map((item, i) => (
              <div key={i} className="grid gap-2 rounded-lg border bg-background p-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <label htmlFor={`life-custom-name-${i}`} className="text-sm font-medium">
                    Nazwa {i + 1}
                  </label>
                  <Input
                    id={`life-custom-name-${i}`}
                    maxLength={40}
                    className="h-11"
                    value={item.name}
                    onChange={(e) => set("custom", answers.custom.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={`life-custom-description-${i}`} className="text-sm font-medium">
                    Opis {i + 1}
                  </label>
                  <Input
                    id={`life-custom-description-${i}`}
                    maxLength={200}
                    className="h-11"
                    value={item.description}
                    onChange={(e) => set("custom", answers.custom.map((c, j) => (j === i ? { ...c, description: e.target.value } : c)))}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11"
                  aria-label={`Usuń własną kategorię ${i + 1}`}
                  onClick={() => set("custom", answers.custom.filter((_, j) => j !== i))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {answers.custom.length < MAX_CUSTOM && (
              <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => set("custom", [...answers.custom, { name: "", description: "" }])}>
                <PlusIcon /> Dodaj własną kategorię
              </Button>
            )}
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>Coś jeszcze</legend>
            <div className="grid gap-1.5">
              <label htmlFor="life-notes" className="text-sm font-medium">
                Coś jeszcze, co warto wiedzieć? (opcjonalnie)
              </label>
              <textarea
                id="life-notes"
                rows={2}
                maxLength={300}
                className="rounded-lg border border-input bg-background px-2 py-2 text-sm"
                placeholder="np. odkładam na własne mieszkanie"
                value={answers.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
          </fieldset>

          <Button type="submit" size="lg" className="h-11 text-base" disabled={saving}>
            {saving ? "Zapisuję…" : "Zapisz wywiad"}
          </Button>
        </form>

        {summary.length > 0 && (
          <div className="mt-4 grid gap-1.5 rounded-xl bg-muted/60 p-3 text-sm" data-testid="life-summary">
            <p className="font-medium">Tak opisujemy Twoją sytuację Jev:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
