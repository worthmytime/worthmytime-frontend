import { api, type Category } from "./api";

/**
 * Podpowiedzi Jev (TypeSafe AI). Frontend nie zna klucza API i nie woła Jev sam: pyta backend,
 * a ten przekazuje pytanie dalej (`POST /ai/categorize`, `POST /ai/map-columns`).
 */

/** Tyle opisów backend przyjmuje w jednym żądaniu. */
const CATEGORIZE_BATCH = 60;

export async function suggestCategories(items: { key: string; description: string }[]): Promise<Record<string, Category>> {
  const out: Record<string, Category> = {};
  for (let i = 0; i < items.length; i += CATEGORIZE_BATCH) {
    const batch = items.slice(i, i + CATEGORIZE_BATCH).map((it) => ({ key: it.key.slice(0, 200), description: it.description.slice(0, 200) }));
    const { suggestions } = await api<{ suggestions: Record<string, Category> }>("/ai/categorize", { body: { items: batch } });
    Object.assign(out, suggestions);
  }
  return out;
}

export async function suggestCategory(description: string): Promise<Category | null> {
  const suggestions = await suggestCategories([{ key: "item", description }]);
  return suggestions.item ?? null;
}

export type ColumnSuggestion = Partial<Record<"date" | "amount" | "description" | "currency", number | null>>;

/** Jev wskazuje, która kolumna pliku z historią transakcji jest datą, kwotą, opisem i walutą (null = brak takiej kolumny). */
export async function suggestMapping(columns: { index: number; header: string; samples: string[] }[]): Promise<ColumnSuggestion> {
  const { mapping } = await api<{ mapping: ColumnSuggestion }>("/ai/map-columns", { body: { columns } });
  return mapping ?? {};
}
