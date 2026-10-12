"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Field } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Category } from "@/lib/api";
import { CATEGORY_INFO, money } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage, parseNumber } from "@/lib/forms";
import type { useRecurring } from "@/lib/use-recurring";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę").max(100),
  amount: z
    .string()
    .transform((s) => parseNumber(s))
    .refine((n) => Number.isFinite(n) && n > 0, "Podaj kwotę większą od zera"),
  day_of_month: z
    .string()
    .transform((s) => Number(s))
    .refine((n) => Number.isInteger(n) && n >= 1 && n <= 31, "Dzień miesiąca od 1 do 31"),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

/** Stałe wydatki (czynsz, abonamenty): ustawiasz raz, a wpis w rejestrze pojawia się co miesiąc w dniu płatności. */
export default function RecurringCard({ recurring, currency }: { recurring: ReturnType<typeof useRecurring>; currency: string }) {
  const [category, setCategory] = useState<Category>("NEEDS");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(schema), defaultValues: { name: "", amount: "", day_of_month: "1" } });

  async function submit(v: FormOut) {
    try {
      await recurring.add({ name: v.name, category, amount: v.amount, day_of_month: v.day_of_month, active: true });
      toast.success("Stały wydatek zapisany");
      reset({ name: "", amount: "", day_of_month: "1" });
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się zapisać stałego wydatku"));
    }
  }

  return (
    <Card data-testid="recurring-card">
      <CardHeader>
        <CardTitle className="text-base">Stałe wydatki</CardTitle>
        <CardDescription>
          Czynsz, abonamenty, ubezpieczenia: wpis w rejestrze pojawia się sam w dniu płatności co miesiąc.
          {recurring.monthlyTotal > 0 && (
            <>
              {" "}
              Razem co miesiąc: <b className="text-foreground tabular-nums" data-testid="recurring-total">{money(recurring.monthlyTotal, currency)}</b>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {recurring.items.length > 0 && (
          <ul className="divide-y" data-testid="recurring-list">
            {recurring.items.map((t) => (
              <li key={t.id} className={cn("flex items-center gap-3 py-2.5", !t.active && "opacity-60")} data-testid={`recurring-${t.name}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {t.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{CATEGORY_INFO[t.category].label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.day_of_month === 31 ? "ostatniego dnia miesiąca" : `co miesiąc ${t.day_of_month}.`}
                    {!t.active && " · wyłączony"}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{money(t.amount, currency)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`${t.active ? "Wyłącz" : "Włącz"} stały wydatek ${t.name}`}
                  onClick={() =>
                    recurring
                      .update(t.id, { name: t.name, category: t.category, amount: t.amount, day_of_month: t.day_of_month, active: !t.active })
                      .catch((e) => toast.error(errorMessage(e)))
                  }
                >
                  {t.active ? "Wyłącz" : "Włącz"}
                </Button>
                <Button
                  variant="ghost"
                  className="size-10"
                  aria-label={`Usuń stały wydatek ${t.name}`}
                  onClick={() => recurring.remove(t.id).catch((e) => toast.error(errorMessage(e)))}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4" aria-label="Dodaj stały wydatek">
          <Field label="Kategoria stałego wydatku">
            {(p) => (
              <select
                {...p}
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base"
              >
                {BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_INFO[c].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Nazwa" error={errors.name?.message}>
            {(p) => <Input {...p} placeholder="np. czynsz" className="h-11" {...register("name")} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opłata miesięczna" error={errors.amount?.message}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="2000" className="h-11" {...register("amount")} />}
            </Field>
            <Field label="Dzień miesiąca" error={errors.day_of_month?.message}>
              {(p) => <Input {...p} inputMode="numeric" className="h-11" {...register("day_of_month")} />}
            </Field>
          </div>
          <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
            Dodaj stały wydatek
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
