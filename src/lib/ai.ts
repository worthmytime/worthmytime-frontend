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
