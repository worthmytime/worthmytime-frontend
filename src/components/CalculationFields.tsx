"use client";

import { PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { suggestCategory } from "@/lib/ai";
import { CATEGORY_INFO, FREQ_LABEL } from "@/lib/format";
import { useCategoryAvailability } from "@/lib/use-availability";
import { money } from "@/lib/format";
import { BUDGET_CATEGORIES, emptyCalcForm, FREQUENCIES, type CalcFormIn, type CalcFormOut } from "@/lib/forms";
import type { CalcType } from "@/lib/api";
import { useApp } from "./AppProvider";
import { Field } from "./FormField";

export type CalcForm = UseFormReturn<CalcFormIn, unknown, CalcFormOut>;

const TYPE_LABEL: Record<CalcType, string> = {
  SIMPLE: "Zakup",
  TCO: "Koszt posiadania",
  RECURRING: "Cykliczny",
};

const FREQ_ITEMS = FREQUENCIES.map((f) => ({ value: f, label: FREQ_LABEL[f] }));

const TYPE_HINT: Record<CalcType, string> = {
  SIMPLE: "Jednorazowy wydatek, np. telefon czy buty.",
  TCO: "Cena zakupu plus koszty utrzymania w czasie, np. samochód.",
  RECURRING: "Subskrypcje i opłaty, które powtarzają się co miesiąc lub rok.",
};

export default function CalculationFields({ form }: { form: CalcForm }) {
  const {
    register,
    control,
    watch,
    setValue,
    reset,
    getValues,
    formState: { errors },
  } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "costs" });
  const type = watch("type");
  const category = watch("category");
  const planned = watch("monthly_contribution");
  const [suggesting, setSuggesting] = useState(false);
  const { profile } = useApp();
  const currency = profile?.currency ?? "PLN";
  const availability = useCategoryAvailability();
  const free = category && availability ? Math.max(availability[category], 0) : null;
  const plannedNumber = Number(String(planned ?? "").replace(",", "."));
  const overMax = free != null && planned !== "" && Number.isFinite(plannedNumber) && plannedNumber > free;
  const costsError = errors.costs?.root?.message ?? (errors.costs as { message?: string } | undefined)?.message;

  async function suggestCalcCategory() {
    const name = watch("name").trim();
    if (!name) return;
    setSuggesting(true);
    try {
      const suggestion = await suggestCategory(name);
      if (suggestion) setValue("category", suggestion, { shouldDirty: true });
    } catch {
      // suggestion is best-effort, no toast needed
    } finally {
      setSuggesting(false);
    }
  }

  function changeType(next: CalcType) {
    if (next === type) return;
    // zmiana typu czyści pola kosztów, ale zostawia nazwę i wybraną kategorię budżetu
    reset({ ...emptyCalcForm(next, getValues("name")), category: getValues("category") });
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Tabs value={type} onValueChange={(v) => changeType(v as CalcType)}>
          <TabsList className="grid h-11! w-full grid-cols-3">
            {(Object.keys(TYPE_LABEL) as CalcType[]).map((t) => (
              <TabsTrigger key={t} value={t} className="text-xs sm:text-sm">
                {TYPE_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">{TYPE_HINT[type]}</p>
      </div>

      <Field label="Co chcesz kupić?" error={errors.name?.message}>
        {(p) => <Input {...p} placeholder="np. iPhone 17 Pro" autoComplete="off" className="h-11" {...register("name")} />}
      </Field>

      {type !== "RECURRING" && (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Cena" error={errors.purchase_price?.message}>
            {(p) => (
              <Input {...p} inputMode="decimal" placeholder="5299" className="h-11" {...register("purchase_price")} />
            )}
          </Field>
          <Field
            label="Okres użytkowania (lata)"
            hint={type === "SIMPLE" ? "Opcjonalnie - policzymy koszt na dzień i miesiąc" : undefined}
            error={errors.ownership_years?.message}
          >
            {(p) => (
              <Input {...p} inputMode="decimal" placeholder="3" className="h-11" {...register("ownership_years")} />
            )}
          </Field>
          {type === "TCO" && (
            <Field label="Wartość odsprzedaży" hint="Po okresie użytkowania" error={errors.resale_value?.message}>
              {(p) => (
                <Input {...p} inputMode="decimal" placeholder="0" className="h-11" {...register("resale_value")} />
              )}
            </Field>
          )}
        </div>
      )}

      {type !== "RECURRING" && (
        <Field label="Ile razy tego użyjesz? (opcjonalnie)" hint="Policzymy koszt jednego użycia" error={errors.expected_uses?.message}>
          {(p) => <Input {...p} inputMode="numeric" placeholder="np. 300" className="h-11" {...register("expected_uses")} />}
        </Field>
      )}

      <fieldset className="grid gap-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <legend className="text-sm font-medium">Kategoria budżetu (opcjonalnie)</legend>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={suggesting || !watch("name").trim()}
            onClick={suggestCalcCategory}
          >
            <SparklesIcon className="size-3.5" />
            {suggesting ? "Analizuję..." : "Zaproponuj AI"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Kategoria budżetu">
          {([""].concat(BUDGET_CATEGORIES) as ("" | (typeof BUDGET_CATEGORIES)[number])[]).map((c) => {
            const active = category === c;
            return (
              <button
                key={c || "none"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setValue("category", c, { shouldDirty: true })}
                className={`min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors ${
                  active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {c ? CATEGORY_INFO[c].label : "Bez kategorii"}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {category
            ? `${CATEGORY_INFO[category].label}: ${CATEGORY_INFO[category].hint}. Sprawdzimy, czy zakup mieści się w Twoim planie budżetowym.`
            : "Wybierz kategorię, a sprawdzimy, czy zakup mieści się w Twoim planie budżetowym."}
        </p>
      </fieldset>

      {category && type !== "RECURRING" && free != null && (
        <div className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm" data-testid="category-availability" aria-live="polite">
          W kategorii <b>{CATEGORY_INFO[category].label}</b> zostało w tym miesiącu <b className="tabular-nums">{money(free, currency)}</b> - tyle
          maksymalnie możesz miesięcznie przeznaczyć na ten wydatek.
          {free > 0 && (
            <button
              type="button"
              className="ml-2 font-medium text-primary underline"
              onClick={() => setValue("monthly_contribution", String(free), { shouldDirty: true })}
            >
              Użyj maksimum
            </button>
          )}
        </div>
      )}

      {category && type !== "RECURRING" && (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Już odłożone" hint="Na ten zakup" error={errors.already_saved?.message}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="0" className="h-11" {...register("already_saved")} />}
          </Field>
          <Field
            label="Miesięczna wpłata"
            hint={free != null ? `Zostaw puste, a przyjmiemy maksimum: ${money(free, currency)}` : "Zostaw puste, a przyjmiemy maksimum z kategorii"}
            error={errors.monthly_contribution?.message ?? (overMax ? `Więcej niż dostępne w kategorii (${money(free ?? 0, currency)})` : undefined)}
          >
            {(p) => <Input {...p} inputMode="decimal" placeholder="np. 1000" className="h-11" {...register("monthly_contribution")} />}
          </Field>
        </div>
      )}

      {type !== "SIMPLE" && (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{type === "RECURRING" ? "Opłaty" : "Koszty dodatkowe"}</p>
          {fields.map((f, i) => (
            <Card key={f.id} size="sm" className="bg-muted/40 shadow-none">
              <CardContent className="grid gap-3">
                <div className="flex items-end gap-2">
                  <Field label="Nazwa" className="flex-1" error={errors.costs?.[i]?.name?.message}>
                    {(p) => <Input {...p} placeholder="np. Paliwo" className="h-11" {...register(`costs.${i}.name`)} />}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="size-11"
                    aria-label={`Usuń pozycję ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kwota" error={errors.costs?.[i]?.amount?.message}>
                    {(p) => <Input {...p} inputMode="decimal" placeholder="700" className="h-11" {...register(`costs.${i}.amount`)} />}
                  </Field>
                  <Field label="Jak często" error={errors.costs?.[i]?.frequency?.message}>
                    {(p) => (
                      <Controller
                        control={control}
                        name={`costs.${i}.frequency`}
                        render={({ field }) => (
                          <Select items={FREQ_ITEMS} value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id={p.id} className="h-11 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FREQ_ITEMS.map((x) => (
                                <SelectItem key={x.value} value={x.value}>
                                  {x.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    )}
                  </Field>
                </div>
              </CardContent>
            </Card>
          ))}
          {costsError && (
            <p role="alert" className="text-xs text-destructive">
              {costsError}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => append({ name: "", amount: "", frequency: type === "RECURRING" ? "MONTHLY" : "YEARLY" })}
          >
            <PlusIcon /> Dodaj pozycję
          </Button>
        </div>
      )}
    </div>
  );
}
