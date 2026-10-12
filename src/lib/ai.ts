import type { Category } from "./api";

export async function suggestCategory(description: string): Promise<Category | null> {
  const res = await fetch("/api/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ key: "item", description }] }),
  });
  if (!res.ok) throw new Error("Nie udało się zasugerować kategorii");
  const { suggestions } = (await res.json()) as { suggestions: Record<string, Category> };
  return suggestions.item ?? null;
}

export async function suggestCategories(
  items: { key: string; description: string }[],
): Promise<Record<string, Category>> {
  const res = await fetch("/api/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error("Nie udało się zasugerować kategorii");
  const { suggestions } = (await res.json()) as { suggestions: Record<string, Category> };
  return suggestions;
}

/** Jev wskazuje, która kolumna pliku z historią transakcji jest datą, kwotą, opisem i walutą (null = brak takiej kolumny). */
export async function suggestMapping(
  columns: { index: number; header: string; samples: string[] }[],
): Promise<Partial<Record<"date" | "amount" | "description" | "currency", number | null>>> {
  const res = await fetch("/api/map-columns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns }),
  });
  if (!res.ok) throw new Error("Nie udało się rozpoznać kolumn");
  const { mapping } = (await res.json()) as { mapping: Partial<Record<"date" | "amount" | "description" | "currency", number | null>> };
  return mapping ?? {};
}
