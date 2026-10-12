import { expect, test } from "@playwright/test";
import { json, PROFILE, RESULT, SAVED, signedIn, withLocalProfile } from "./mocks";

const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };

test("dashboard pokazuje prawdziwe wydatki z rejestru, koszty cykliczne i osobno zakupy z kalkulatora", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00"));
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: zero,
      loans: [
        { id: "l1", name: "Kredyt auto", installment_amount: 800, installments_left: 24, payment_day: 12 },
        { id: "l2", name: "Spłacona pożyczka", installment_amount: 300, installments_left: 0, end_date: "2026-08-11", payment_day: 11 },
      ],
      monthly_loans: 800,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 1500, FUTURE: 1250, GOALS: 1050, FUN: 200 },
      monthly_income: 7000,
      total_spent: 3000,
      is_custom: true,
    }),
  );
  await page.route("**/api/v1/reports/month**", (r) =>
    json(r, {
      month: "2026-10",
      previous_month: "2026-09",
      currency: "PLN",
      monthly_income: 7000,
      categories: [],
      total_spent: 3000,
      previous: 2500,
      change: 500,
      change_percent: 20,
      saved: { future: 500, unspent: 4000, goals: 0 },
      discretionary: { spent: 500, work_hours: 12.4 },
      largest_expense: { id: "e1", category: "NEEDS", amount: 1200, note: "czynsz", spent_on: "2026-10-02" },
      entries: 9,
    }),
  );
  await page.route("**/api/v1/expenses/summary**", (r) =>
    json(r, {
      months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, i) => ({ month, totals: zero, total: 1500 + i * 150 })),
    }),
  );
  await page.route("**/api/v1/recurring-expenses**", (r) =>
    json(r, {
      items: [
        { id: "r1", name: "Internet", category: "NEEDS", amount: 60, day_of_month: 15, active: true, start_date: "2026-01-01" },
        { id: "r2", name: "Siłownia (wyłączona)", category: "FUN", amount: 150, day_of_month: 1, active: false, start_date: "2026-01-01" },
      ],
      monthly_total: 60,
    }),
  );
  const subscription = { ...SAVED, id: "c2", name: "Netflix", type: "RECURRING", result: { ...RESULT, horizons: [{ label: "1 year", cost: 720, work: RESULT.work }] } };
  await page.route("**/api/v1/calculations", (r) => json(r, { items: [SAVED, subscription] }));
  await signedIn(page);
  await page.goto("/dashboard");

  // liczby miesiąca pochodzą z rejestru, a nie z obliczeń w kalkulatorze
  await expect(page.getByTestId("metric-total")).toContainText(/3\s000,00\szł/);
  await expect(page.getByTestId("metric-total")).toContainText(/\+500,00\szł względem poprzedniego miesiąca/);
  await expect(page.getByTestId("metric-largest")).toContainText(/1\s200,00\szł/);
  await expect(page.getByTestId("metric-largest")).toContainText("czynsz");
  await expect(page.getByTestId("metric-largest")).not.toContainText("iPhone");
  await expect(page.getByTestId("metric-hours")).toContainText("12,4 h");
  await expect(page.getByTestId("dashboard-chart")).toBeVisible(); // sześć miesięcy rejestru

  // koszty cykliczne: aktywna rata, aktywny stały wydatek i subskrypcja; spłacona pożyczka i wyłączony wydatek odpadają
  const cyclic = page.getByTestId("dashboard-cyclic");
  await expect(cyclic.locator("li")).toHaveCount(3);
  await expect(cyclic).toContainText("Kredyt auto");
  await expect(cyclic).toContainText("Internet");
  await expect(cyclic).toContainText("Netflix");
  await expect(cyclic).not.toContainText("Spłacona pożyczka");
  await expect(cyclic).not.toContainText("Siłownia");
  await expect(cyclic).toContainText(/Razem miesięcznie: 920,00\szł/); // 800 + 60 + 720/12

  // zakupy z kalkulatora są osobno i wprost opisane jako nie-wydatki
  const analyzed = page.getByTestId("dashboard-analyzed");
  await expect(analyzed).toContainText("nie wydatki");
  await expect(analyzed).toContainText(/1 zakup o wartości 5\s299,00\szł/);
});

test("dashboard wymaga konta", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/dashboard");
  await expect(page.getByText("Dashboard jest dostępne po zalogowaniu.")).toBeVisible();
});
