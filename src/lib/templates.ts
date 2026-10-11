import type { ExpenseTemplate } from "./api";

/** Szablony szybkich wydatków anonimowego użytkownika (zalogowany używa API). */
const TEMPLATES_KEY = "wmt_expense_templates";

/** Tyle samo co limit w API, żeby rząd przycisków pozostał krótki. */
export const MAX_TEMPLATES = 20;

export function readLocalTemplates(): ExpenseTemplate[] {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as ExpenseTemplate[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalTemplates(items: ExpenseTemplate[]) {
  try {
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(items));
  } catch {}
}
