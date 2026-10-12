"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { money, num } from "@/lib/format";
import { applyServerErrors, errorMessage, profileFromForm, profileSchema, profileToForm, type ProfileFormIn, type ProfileFormOut, parseNumber, numeric } from "@/lib/forms";
import { useApp } from "./AppProvider";
import { Field } from "./FormField";

const toNumber = (s: string) => (s.trim() === "" ? null : parseNumber(s));

export default function ProfileForm({ onSaved, submitLabel = "Zapisz profil" }: { onSaved?: () => void; submitLabel?: string }) {
  const { profile, saveProfile } = useApp();
  const form = useForm<ProfileFormIn, unknown, ProfileFormOut>({
    resolver: zodResolver(profileSchema),
    defaultValues: profileToForm(profile),
  });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = form;

  const w = useWatch({ control });
  const hoursPerDay = toNumber(w.hours_per_day ?? "") ?? 0;
  const daysPerWeek = toNumber(w.days_per_week ?? "") ?? 0;
  const hoursPerMonth = (hoursPerDay * daysPerWeek * 52) / 12;
  const rate = toNumber(w.hourly_rate ?? "") ?? ((toNumber(w.monthly_income ?? "") ?? 0) / hoursPerMonth || null);
  // realna stawka: (dochód - koszty pracy) / (godziny pracy + godziny dojazdu w miesiącu)
  const income = toNumber(w.hourly_rate ?? "") != null ? (toNumber(w.hourly_rate ?? "") ?? 0) * hoursPerMonth : (toNumber(w.monthly_income ?? "") ?? 0);
  const commuteHours = ((toNumber(w.commute_minutes_per_day ?? "") ?? 0) / 60) * daysPerWeek * (52 / 12);
  const workCosts = toNumber(w.work_costs_monthly ?? "") ?? 0;
  const realRate = income > 0 && hoursPerMonth > 0 ? Math.max(income - workCosts, 0.01) / (hoursPerMonth + commuteHours) : null;
  const showReal = realRate != null && (commuteHours > 0 || workCosts > 0);
  const mode = w.rate_mode ?? "NOMINAL";
  const currency = (w.currency ?? "PLN").toUpperCase();
  const validCurrency = /^[A-Z]{3}$/.test(currency);

  async function submit(values: ProfileFormOut) {
    try {
      await saveProfile(profileFromForm(values));
      toast.success("Profil zapisany");
      onSaved?.();
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(errorMessage(e, "Nie udało się zapisać profilu"));
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Miesięczny dochód netto" error={errors.monthly_income?.message}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="np. 7000" className="h-11" {...numeric(register("monthly_income"))} />}
        </Field>
        <Field label="Waluta" error={errors.currency?.message}>
          {(p) => <Input {...p} maxLength={3} className="h-11 uppercase" {...register("currency")} />}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Godzin pracy dziennie" error={errors.hours_per_day?.message}>
          {(p) => <Input {...p} inputMode="decimal" className="h-11" {...numeric(register("hours_per_day"))} />}
        </Field>
        <Field label="Dni pracy w tygodniu" error={errors.days_per_week?.message}>
          {(p) => <Input {...p} inputMode="decimal" className="h-11" {...numeric(register("days_per_week"))} />}
        </Field>
      </div>

      <Field
        label="Stawka godzinowa (opcjonalnie)"
        hint="Jeśli ją podasz, ma pierwszeństwo przed dochodem miesięcznym."
        error={errors.hourly_rate?.message}
      >
        {(p) => <Input {...p} inputMode="decimal" placeholder="np. 42" className="h-11" {...numeric(register("hourly_rate"))} />}
      </Field>

      <fieldset className="grid gap-4 rounded-xl border bg-muted/30 p-3" data-testid="real-rate-section">
        <legend className="px-1 text-sm font-medium">Realna stawka godzinowa (opcjonalnie)</legend>
        <p className="text-xs text-muted-foreground">
          Dojazd i koszty związane z pracą (bilet, paliwo, lunche, ubrania) zjadają część pensji i czasu. Podaj je, a policzymy, ile naprawdę zarabiasz na godzinę.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dojazd dziennie (minuty, tam i z powrotem)" error={errors.commute_minutes_per_day?.message}>
            {(p) => <Input {...p} inputMode="numeric" placeholder="np. 90" className="h-11" {...numeric(register("commute_minutes_per_day"))} />}
          </Field>
          <Field label="Koszty pracy miesięcznie" hint="Dojazd, lunche, ubrania" error={errors.work_costs_monthly?.message}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="np. 600" className="h-11" {...numeric(register("work_costs_monthly"))} />}
          </Field>
        </div>
        {showReal && rate != null && (
          <div className="grid gap-3" aria-live="polite">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-muted/60 px-1 py-2.5">
                <div className="text-base font-semibold tabular-nums" data-testid="nominal-rate">{money(rate, validCurrency ? currency : "PLN")}/h</div>
                <div className="text-xs text-muted-foreground">nominalna</div>
              </div>
              <div className="rounded-xl bg-primary/10 px-1 py-2.5">
                <div className="text-base font-semibold tabular-nums" data-testid="real-rate">{money(realRate, validCurrency ? currency : "PLN")}/h</div>
                <div className="text-xs text-muted-foreground">realna</div>
              </div>
            </div>
            <div role="radiogroup" aria-label="Stawka używana w obliczeniach" className="grid grid-cols-2 gap-2">
              {(["NOMINAL", "REAL"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setValue("rate_mode", m, { shouldDirty: true })}
                  className={`min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors ${mode === m ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Licz {m === "NOMINAL" ? "nominalną" : "realną"}
                </button>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      {rate != null && Number.isFinite(rate) && rate > 0 && (
        <div className="rounded-lg bg-primary/10 px-4 py-3 text-sm" aria-live="polite">
          {hoursPerMonth > 0 && <span className="text-muted-foreground">≈ {num(hoursPerMonth, 0)} h / miesiąc · </span>}
          Twoja godzina pracy jest warta{" "}
          <b className="text-foreground">{money(rate, validCurrency ? currency : "PLN")}</b>
        </div>
      )}

      <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
        {isSubmitting ? "Zapisuję…" : submitLabel}
      </Button>
    </form>
  );
}
