import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

const PERCENTAGES = { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 };
const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };

test("raty (bez konta): rata po terminie zostaje widoczna, a opłacone nie znikają", async ({ page }) => {
  // 20 października: rata z 11. dnia miesiąca jest 9 dni po terminie, kolejna wypada 11 listopada (za 22 dni)
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00"));
  await withLocalProfile(page);
  await page.addInitScript((percentages) => {
    const loans = [{ name: "Kredyt auto", installment_amount: 800, installments_left: 24, payment_day: 11 }];
    window.localStorage.setItem("wmt_budget", JSON.stringify({ percentages, spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, loans }));
  }, PERCENTAGES);
  await page.goto("/expenses");

  const card = page.getByTestId("upcoming-installments");
  await expect(card.locator("li")).toHaveCount(2);
  await expect(card.locator("li").nth(0)).toContainText("11 października 2026");
  await expect(card.locator("li").nth(0)).toContainText("9 dni po terminie");
  await expect(card.locator("li").nth(1)).toContainText("11 listopada 2026");
  await expect(card.locator("li").nth(1)).toContainText("za 22 dni");

  const needs = page.getByTestId("usage-NEEDS");
  await expect(needs).toContainText("2 raty do zapłaty");
  await needs.getByRole("button", { expanded: false }).click();
  const rows = page.getByTestId("loan-rows-NEEDS");
  await expect(rows.locator("li")).toHaveCount(2);
  await expect(rows.getByTestId("loan-row-status").nth(0)).toHaveText("rata po terminie");
  await expect(rows.getByTestId("loan-row-status").nth(1)).toHaveText("rata do zapłaty");

  // zaległa rata oznaczona jako zapłacona: wpis jest w wydatkach tego miesiąca, a na liście rat widać "Opłacona"
  await card.getByRole("button", { name: /Oznacz ratę Kredyt auto jako zapłaconą, termin 11 października 2026/ }).click();
  await expect(page.getByTestId("paid-0")).toContainText("Opłacona");
  await expect(page.getByTestId("expense-list-NEEDS")).toContainText("Rata: Kredyt auto");
  await expect(needs).toContainText("1 rata do zapłaty");

  // kolejna rata opłacona z góry: nie znika, tylko zmienia status
  await card.getByRole("button", { name: /Oznacz ratę Kredyt auto jako zapłaconą, termin 11 listopada 2026/ }).click();
  await expect(page.getByTestId("paid-1")).toContainText("Opłacona");
  await expect(rows.locator("li")).toHaveCount(1);
  await expect(rows.getByTestId("loan-row-status")).toHaveText("opłacona z góry");
  await expect(rows).toContainText("11 listopada 2026");
  await expect(needs).not.toContainText("do zapłaty");

  // po odświeżeniu stan się nie zmienia
  await page.reload();
  await expect(page.getByTestId("upcoming-installments").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("paid-0")).toBeVisible();
  await expect(page.getByTestId("paid-1")).toBeVisible();
});

test("raty (konto): rata opłacona z góry w kolejnym miesiącu jest rozpoznana po odświeżeniu", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00"));
  const loan = { id: "l1", name: "Kredyt auto", installment_amount: 800, installments_left: 24, payment_day: 11 };
  const entry = (id: string, day: string) => ({ id, category: "NEEDS", amount: 800, note: "Rata: Kredyt auto", spent_on: day, source_type: "LOAN", source_id: "l1" });
  const asked: string[] = [];
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: PERCENTAGES,
      spent: zero,
      loans: [loan],
      monthly_loans: 800,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 2700, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      monthly_income: 7000,
      total_spent: 800,
      is_custom: true,
    }),
  );
  await page.route("**/api/v1/recurring-expenses**", (r) => json(r, { items: [], monthly_total: 0 }));
  await page.route("**/api/v1/expenses**", (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith("/summary")) return json(r, { months: [] });
    const month = url.searchParams.get("month") ?? "2026-10";
    asked.push(month);
    // październikowa rata opłacona po terminie, listopadowa opłacona z góry
    const items = month === "2026-11" ? [entry("e2", "2026-11-11")] : [entry("e1", "2026-10-11")];
    return json(r, { month, items, totals: zero, total: 0, loan_payments: 800 });
  });
  await signedIn(page);
  await page.goto("/expenses");

  const card = page.getByTestId("upcoming-installments");
  await expect(card.locator("li")).toHaveCount(2);
  await expect(page.getByTestId("paid-0")).toContainText("Opłacona");
  await expect(page.getByTestId("paid-1")).toContainText("Opłacona");
  await expect(card.getByRole("button", { name: /jako zapłaconą/ })).toHaveCount(0);
  expect(asked).toContain("2026-11"); // raty z kolejnego miesiąca pobieramy osobno

  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("expense-list-NEEDS")).toContainText("Rata: Kredyt auto"); // rata z tego miesiąca jest w wydatkach
  await expect(page.getByTestId("loan-rows-NEEDS").getByTestId("loan-row-status")).toHaveText("opłacona z góry");
});
