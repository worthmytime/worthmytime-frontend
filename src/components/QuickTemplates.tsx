"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ExpenseTemplate } from "@/lib/api";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/forms";

interface Props {
  items: ExpenseTemplate[];
  currency: string;
  onApply: (t: ExpenseTemplate) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

/** Rząd przycisków z ulubionymi wydatkami: jedno dotknięcie dopisuje wpis z dzisiejszą datą. */
export default function QuickTemplates({ items, currency, onApply, onRemove }: Props) {
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // id szablonu, którego akcja właśnie trwa

  if (items.length === 0) return null;

  async function apply(t: ExpenseTemplate) {
    setBusy(t.id);
    try {
      await onApply(t);
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się dopisać wydatku"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: ExpenseTemplate) {
    setBusy(t.id);
    try {
      await onRemove(t.id);
      toast.success(`Usunięto szablon: ${t.name}`);
      if (items.length === 1) setManaging(false);
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się usunąć szablonu"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2" data-testid="quick-templates">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Szybkie szablony</span>
        <Button type="button" variant="ghost" size="sm" aria-pressed={managing} onClick={() => setManaging((m) => !m)}>
          {managing ? "Gotowe" : "Zarządzaj"}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Szybkie szablony">
        {items.map((t) => (
          <li key={t.id} className="max-w-full">
            {managing ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 max-w-full gap-2 px-3"
                aria-label={`Usuń szablon ${t.name}`}
                disabled={busy === t.id}
                onClick={() => void remove(t)}
              >
                <Trash2Icon aria-hidden />
                <span className="truncate">{t.name}</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 max-w-full gap-2 px-3"
                aria-label={`Dopisz ${t.name}, ${money(t.amount, currency)}`}
                disabled={busy === t.id}
                onClick={() => void apply(t)}
              >
                <span className="truncate">{t.name}</span>
                <span className="tabular-nums text-muted-foreground">{money(t.amount, currency)}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
