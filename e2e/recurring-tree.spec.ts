import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

/** Dodaje stały wydatek z karty "Stałe wydatki" (kategoria domyślnie Potrzeby). */
async function addRecurring(page: Page, name: string, amount: string, day: string) {
  const card = page.getByTestId("recurring-card");
  await card.getByLabel("Nazwa").fill(name);
  await card.getByLabel("Opłata miesięczna").fill(amount);
  await card.getByLabel("Dzień miesiąca").fill(day);
  await card.getByRole("button", { name: "Dodaj stały wydatek" }).click();
  await expect(card.getByTestId(`recurring-${name}`)).toBeVisible();
}

const expandNeeds = (page: Page) => page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();

test("stały wydatek z terminem później w miesiącu jest w drzewku jako zaplanowany i nie liczy się do wydanych", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await addRecurring(page, "Siłownia", "150", "25");
  await expandNeeds(page);

  const planned = page.getByTestId("planned-list-NEEDS");
  await expect(planned).toContainText("Siłownia");
  await expect(planned).toContainText("stały · zaplanowany");
  await expect(planned).toContainText("25 października 2026");
  await expect(page.getByTestId("usage-NEEDS")).toContainText("1 zaplanowany");
  await expect(page.getByTestId("usage-NEEDS")).toContainText("(0%)"); // zaplanowane nie wchodzi do wydanych
  await expect(page.getByText("Brak wpisów w tej kategorii.")).toHaveCount(0);
});

test("stały wydatek z terminem, który już minął w tym miesiącu, jest zaplanowany na następny miesiąc", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await addRecurring(page, "Czynsz", "2000", "5");
  await expandNeeds(page);
  await expect(page.getByTestId("planned-Czynsz")).toContainText("5 listopada 2026");
});

test("stały wydatek z dzisiejszym terminem od razu jest wpisem w rejestrze, a nie zaplanowanym", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await addRecurring(page, "Abonament", "50", "10");
  await expandNeeds(page);
  await expect(page.getByTestId("expense-list-NEEDS")).toContainText("Abonament");
  await expect(page.getByTestId("planned-list-NEEDS")).toHaveCount(0);
});

test("konto: zaplanowane są tylko stałe wydatki bez wpisu w tym miesiącu", async ({ page }) => {
  const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: zero,
      ledger: zero,
      spent_total: zero,
      loans: [],
      monthly_loans: 0,
      loans_income_percent: null,
      last_installment_in_months: 0,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      monthly_income: 7000,
      total_spent: 0,
      is_custom: false,
    }),
  );
  await page.route("**/api/v1/recurring-expenses**", (r) =>
    json(r, {
      items: [
        { id: "t1", name: "Czynsz", category: "NEEDS", amount: 2000, day_of_month: 5, active: true, start_date: "2026-10-09" },
        { id: "t2", name: "Netflix", category: "FUN", amount: 50, day_of_month: 3, active: true, start_date: "2026-01-03" },
        { id: "t3", name: "Stary abonament", category: "FUN", amount: 20, day_of_month: 20, active: false, start_date: "2026-01-03" },
      ],
      monthly_total: 2050,
    }),
  );
  await page.route("**/api/v1/expenses**", (r) =>
    json(
      r,
      r.request().url().includes("summary")
        ? { months: [] }
        : {
            month: "2026-10",
            // Netflix ma już wpis z 3. października; Czynsz (dodany po terminie) jeszcze nie
            items: [{ id: "e1", category: "FUN", amount: 50, note: "Netflix", spent_on: "2026-10-03", source_type: "RECURRING", source_id: "t2" }],
            totals: { ...zero, FUN: 50 },
            total: 50,
            loan_payments: 0,
          },
    ),
  );
  await signedIn(page);
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await page.goto("/expenses");

  await expandNeeds(page);
  await expect(page.getByTestId("planned-Czynsz")).toContainText("5 listopada 2026");

  await page.getByTestId("usage-FUN").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("expense-list-FUN")).toContainText("Netflix"); // wpis z rejestru
  await expect(page.getByTestId("planned-list-FUN")).toHaveCount(0); // Netflix ma wpis, a wyłączony abonament się nie liczy
});
