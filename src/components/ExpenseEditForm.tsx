"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Field } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Category, Expense } from "@/lib/api";
import { CATEGORY_INFO } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage } from "@/lib/forms";
import type { NewExpense } from "@/lib/use-ledger";

const schema = z.object({
  amount: z
    .string()
    .transform((s) => Number(s.replace(",", ".")))
    .refine((n) => Number.isFinite(n) && n > 0, "Podaj kwotę większą od zera"),
  note: z.string().trim().max(200),
  spent_on: z.string().min(1, "Podaj datę"),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

/** Edycja wpisu w rejestrze wydatków (w wierszu listy): kategoria, kwota, notatka i data. */
export default function ExpenseEditForm({
  entry,
  onSave,
  onCancel,
}: {
  entry: Expense;
  onSave: (e: NewExpense) => Promise<void>;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<Category>(entry.category);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: { amount: String(entry.amount).replace(".", ","), note: entry.note ?? "", spent_on: entry.spent_on },
  });

  async function submit(v: FormOut) {
    try {
      await onSave({ category, amount: v.amount, note: v.note || undefined, spent_on: v.spent_on });
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się zapisać zmian"));
    }
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      aria-label={`Edycja wydatku ${entry.note || CATEGORY_INFO[entry.category].label}`}
      data-testid="expense-edit-form"
      className="grid w-full gap-3 py-2"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kategoria wpisu">
          {(p) => (
            <select
              {...p}
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-base"
            >
              {BUDGET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_INFO[c].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Kwota wpisu" error={errors.amount?.message}>
          {(p) => <Input {...p} inputMode="decimal" className="h-10" {...register("amount")} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data wpisu" error={errors.spent_on?.message}>
          {(p) => <Input {...p} type="date" className="h-10" {...register("spent_on")} />}
        </Field>
        <Field label="Notatka wpisu" error={errors.note?.message}>
          {(p) => <Input {...p} className="h-10" {...register("note")} />}
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="h-10" disabled={isSubmitting}>
          Zapisz
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}
