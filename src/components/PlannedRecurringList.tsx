import type { Category } from "@/lib/api";
import { money } from "@/lib/format";
import { dateLabel } from "@/lib/loans";
import type { PlannedRecurring } from "@/lib/recurring";

/** Stałe wydatki kategorii czekające na termin płatności: widać je w drzewku, ale nie wchodzą do sum wydanych. */
export default function PlannedRecurringList({ planned, category, currency }: { planned: PlannedRecurring[]; category: Category; currency: string }) {
  if (planned.length === 0) return null;
  return (
    <ul className="divide-y" data-testid={`planned-list-${category}`}>
      {planned.map(({ template: t, due }) => (
        <li key={t.id} className="flex items-center gap-2 py-1.5 opacity-70" data-testid={`planned-${t.name}`}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {t.name}
              <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">stały · zaplanowany</span>
            </p>
            <p className="text-xs text-muted-foreground">najbliższa płatność: {dateLabel(due)}</p>
          </div>
          <span className="tabular-nums text-sm font-semibold">{money(t.amount, currency)}</span>
        </li>
      ))}
    </ul>
  );
}
