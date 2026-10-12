import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

test("pasek nawigacji (bez konta): kwota, która została w tym miesiącu, maleje po dopisaniu wydatku", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page); // dochód 7 000 zł
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "wmt_budget",
      JSON.stringify({
        percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
        spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
        loans: [{ name: "Kredyt auto", installment_amount: 800, installments_left: 24, payment_day: 12 }],
      }),
    ),
  );
  await page.goto("/expenses");
  const balance = page.getByTestId("nav-balance");
  await expect(balance).toHaveText(/6\s200,00\szł/); // 7 000 - 800 raty
  await expect(balance).toHaveAccessibleName(/Zostało w tym miesiącu: 6\s200,00\szł/);

  await page.getByLabel("Kwota").fill("2 792,22");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(balance).toHaveText(/3\s407,78\szł/);

  // kwota jest w pasku na każdej stronie i prowadzi do Wydatków
  await page.goto("/calculator");
  await expect(page.getByTestId("nav-balance")).toHaveText(/3\s407,78\szł/);
  await page.getByTestId("nav-balance").click();
  await expect(page).toHaveURL(/\/expenses$/);
});

test("pasek nawigacji (konto): kwota z budżetu w API, ujemna jest wyróżniona", async ({ page }) => {
  let spent = 3592.22;
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
      loans: [],
      monthly_loans: 0,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      monthly_income: 7000,
      total_spent: spent,
      is_custom: false,
    }),
  );
  await signedIn(page);
  await page.goto("/calculator");
  const balance = page.getByTestId("nav-balance");
  await expect(balance).toHaveText(/3\s407,78\szł/);
  await expect(balance).not.toHaveClass(/text-destructive/);

  // po przejściu na inną stronę kwota pobiera się ponownie
  spent = 7250;
  await page.goto("/compare");
  await expect(page.getByTestId("nav-balance")).toHaveText(/-250,00\szł/);
  await expect(page.getByTestId("nav-balance")).toHaveClass(/text-destructive/);
});

test("pasek nawigacji bez profilu nie pokazuje kwoty", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-balance")).toHaveCount(0);
});
