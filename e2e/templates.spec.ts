import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

test("szybkie szablony (bez konta): zapis z formularza, dopisanie jednym dotknięciem i usunięcie", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await expect(page.getByTestId("quick-templates")).toHaveCount(0); // bez szablonów nie ma rzędu przycisków

  // bez kwoty i nazwy szablon się nie zapisze, a błąd jest przy polu
  await page.getByRole("button", { name: "Zapisz jako szablon" }).click();
  await expect(page.getByText("Podaj kwotę większą od zera")).toBeVisible();
  await page.getByLabel("Kwota").fill("14,50");
  await page.getByRole("button", { name: "Zapisz jako szablon" }).click();
  await expect(page.getByText("Wpisz w notatce nazwę szablonu, np. kawa")).toBeVisible();

  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Notatka (opcjonalnie)").fill("Kawa");
  await page.getByRole("button", { name: "Zapisz jako szablon" }).click();
  const templates = page.getByTestId("quick-templates");
  await expect(templates).toContainText("Kawa");
  await expect(templates).toContainText(/14,50\szł/);

  // jedno dotknięcie dopisuje wpis; ten sam szablon można użyć drugi raz tego samego dnia
  const coffee = page.getByRole("button", { name: /^Dopisz Kawa/ });
  await coffee.click();
  const list = page.getByTestId("expense-list-FUN");
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText("Kawa");
  await coffee.click();
  await expect(list.locator("li")).toHaveCount(2);
  await expect(page.getByTestId("usage-FUN")).toContainText(/29,00\szł/);

  // szablon zostaje po odświeżeniu strony
  await page.reload();
  await expect(page.getByTestId("quick-templates")).toContainText("Kawa");

  // usunięcie szablonu nie rusza wpisów dopisanych wcześniej
  await page.getByRole("button", { name: "Zarządzaj" }).click();
  await page.getByRole("button", { name: "Usuń szablon Kawa" }).click();
  await expect(page.getByTestId("quick-templates")).toHaveCount(0);
  await page.getByTestId("usage-FUN").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("expense-list-FUN").locator("li")).toHaveCount(2);
});

test("szybkie szablony (konto): zapis, użycie i usunięcie idą przez API", async ({ page }) => {
  const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };
  let templates: { id: string; name: string; category: string; amount: number }[] = [];
  let expenses: Record<string, unknown>[] = [];
  const calls: string[] = [];
  let created: Record<string, unknown> | undefined;

  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: zero,
      loans: [],
      monthly_loans: 0,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      monthly_income: 7000,
      total_spent: 0,
      is_custom: false,
    }),
  );
  await page.route("**/api/v1/recurring-expenses**", (r) => json(r, { items: [], monthly_total: 0 }));
  await page.route("**/api/v1/expenses**", (r) => {
    if (r.request().url().includes("summary")) return json(r, { months: [] });
    const total = expenses.reduce((s, e) => s + (e.amount as number), 0);
    return json(r, { month: "2026-10", items: expenses, totals: { ...zero, FUN: total }, total, loan_payments: 0 });
  });
  await page.route("**/api/v1/expense-templates**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (req.method() === "GET") return json(r, { items: templates });
    calls.push(`${req.method()} ${path}`);
    if (req.method() === "DELETE") {
      templates = templates.filter((t) => !path.endsWith(`/${t.id}`));
      return json(r, { deleted: true });
    }
    if (path.endsWith("/use")) {
      const t = templates[0];
      const entry = { id: `e${expenses.length + 1}`, category: t.category, amount: t.amount, note: t.name, spent_on: "2026-10-10" };
      expenses = [entry, ...expenses];
      return json(r, entry, 201);
    }
    created = req.postDataJSON();
    templates = [...templates, { id: "t1", ...(created as { name: string; category: string; amount: number }) }];
    return json(r, templates[0], 201);
  });
  await signedIn(page);
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await page.goto("/expenses");

  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Kwota").fill("14,50");
  await page.getByLabel("Notatka (opcjonalnie)").fill("Kawa");
  await page.getByRole("button", { name: "Zapisz jako szablon" }).click();
  await expect(page.getByTestId("quick-templates")).toContainText("Kawa");
  expect(created).toEqual({ name: "Kawa", category: "FUN", amount: 14.5 });

  await page.getByRole("button", { name: /^Dopisz Kawa/ }).click();
  await expect(page.getByTestId("expense-list-FUN")).toContainText("Kawa"); // lista odświeżona z API
  expect(calls).toContain("POST /expense-templates/t1/use");

  await page.getByRole("button", { name: "Zarządzaj" }).click();
  await page.getByRole("button", { name: "Usuń szablon Kawa" }).click();
  await expect(page.getByTestId("quick-templates")).toHaveCount(0);
  expect(calls).toContain("DELETE /expense-templates/t1");
});
