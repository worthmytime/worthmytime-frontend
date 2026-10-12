import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

test("budżet (konto): przełącznik przenoszenia środków, przeniesiona kwota i zapis ustawienia", async ({ page }) => {
  const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };
  // Przyjemności mają włączone przenoszenie i 200 zł z poprzedniego miesiąca (budżet 700 zł przy dochodzie 7 000 zł)
  let budget = {
    percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
    spent: zero,
    loans: [],
    monthly_loans: 0,
    loans_income_percent: 0,
    last_installment_in_months: 0,
    amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 900 },
    available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 900 },
    rollover: { NEEDS: false, FUTURE: false, GOALS: false, FUN: true },
    rollover_amounts: { ...zero, FUN: 200 },
    monthly_income: 7000,
    total_spent: 0,
    is_custom: true,
  };
  let saved: { rollover?: Record<string, boolean> } | undefined;

  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) => {
    if (r.request().method() === "PUT") {
      saved = r.request().postDataJSON();
      budget = { ...budget, rollover: saved!.rollover as typeof budget.rollover };
    }
    return json(r, budget);
  });
  await page.route("**/api/v1/recurring-expenses**", (r) => json(r, { items: [], monthly_total: 0 }));
  await page.route("**/api/v1/expenses**", (r) =>
    json(r, r.request().url().includes("summary") ? { months: [] } : { month: "2026-10", items: [], totals: zero, total: 0, loan_payments: 0 }),
  );
  await signedIn(page);
  await page.goto("/budget");

  const fun = page.getByTestId("budget-FUN");
  await expect(fun.getByRole("switch")).toBeChecked();
  await expect(page.getByTestId("rollover-info-FUN")).toContainText(/przeniesiono 200,00\szł/);
  await expect(fun).toContainText(/Budżet:\s900,00\szł/); // 700 zł z podziału + 200 zł przeniesione

  const goals = page.getByTestId("budget-GOALS");
  await expect(goals.getByRole("switch")).not.toBeChecked();
  await expect(page.getByTestId("rollover-info-GOALS")).toContainText("Wyłączone");

  // włączenie w Celach i zapis: ustawienie idzie do API razem z planem
  await goals.getByRole("switch").check();
  await expect(page.getByTestId("rollover-info-GOALS")).toContainText("nic nie przeniesiono");
  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  await expect(page.getByText("Budżet zapisany")).toBeVisible();
  expect(saved?.rollover).toEqual({ NEEDS: false, FUTURE: false, GOALS: true, FUN: true });
  await expect(page.getByTestId("budget-GOALS").getByRole("switch")).toBeChecked();

  // wyłączenie od razu pokazuje budżet bez przeniesionej kwoty
  await page.getByTestId("budget-FUN").getByRole("switch").uncheck();
  await expect(page.getByTestId("budget-FUN")).toContainText(/Budżet:\s700,00\szł/);
  await expect(page.getByTestId("rollover-info-FUN")).toContainText("Wyłączone");
});

test("budżet (bez konta): przenoszenie środków wymaga konta", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/budget");

  await expect(page.getByTestId("rollover-info-FUN")).toContainText("dostępne po zalogowaniu");
  await expect(page.getByRole("switch")).toHaveCount(0);
  // zapis planu bez konta działa jak dotąd
  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  await expect(page.getByText("Budżet zapisany")).toBeVisible();
});
