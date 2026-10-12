import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalLedger, withLocalProfile } from "./mocks";

// dochód 7 000 zł: Przyjemności 700 zł (10%)

test("dzwonek (bez konta): alert przy 80% budżetu, ukrycie i powrót po przekroczeniu 100%", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await withLocalLedger(page, [{ category: "FUN", amount: 600 }]);
  await page.goto("/expenses");

  const bell = page.getByTestId("alerts-bell");
  await expect(page.getByTestId("alerts-count")).toHaveText("1");
  await expect(bell).toHaveAccessibleName("Alerty (1)");

  await bell.click();
  const alert = page.getByTestId("alert-CATEGORY_USAGE:FUN");
  await expect(alert).toHaveAttribute("data-level", "warning");
  await expect(alert).toContainText("Przyjemności: 85,7% budżetu");
  await expect(alert).toContainText(/Zostało\s100,00\szł z 700,00\szł/);

  await page.getByRole("button", { name: /Ukryj alert/ }).click();
  await expect(page.getByTestId("alerts-empty")).toBeVisible();
  await expect(page.getByTestId("alerts-count")).toHaveCount(0);

  // ukrycie przetrwa odświeżenie: stan alertu (80%) się nie zmienił
  await page.reload();
  await expect(page.getByTestId("alerts-count")).toHaveCount(0);

  // po dopisaniu wydatku kategoria przekracza 100%: inny stan, więc alert wraca jako pilny
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Kwota").fill("200");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByTestId("alerts-count")).toHaveText("1");
  await page.getByTestId("alerts-bell").click();
  const again = page.getByTestId("alert-CATEGORY_USAGE:FUN");
  await expect(again).toHaveAttribute("data-level", "critical");
  await expect(again).toContainText("Budżet kategorii wyczerpany");
  await again.getByRole("link", { name: "Przejdź do ekranu" }).click();
  await expect(page).toHaveURL(/\/budget$/);
});

test("dzwonek (bez konta): rata w ciągu 3 dni i brak alertów, gdy wszystko w normie", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
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
  await page.getByTestId("alerts-bell").click();
  const alert = page.getByTestId("alert-LOAN_DUE:local:Kredyt auto:800");
  await expect(alert).toContainText("Rata: Kredyt auto");
  await expect(alert).toContainText("za 2 dni");
  await alert.getByRole("link", { name: "Przejdź do ekranu" }).click();
  await expect(page).toHaveURL(/\/expenses$/);

  // rata za 5 dni nie jest jeszcze alertem
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.reload();
  await expect(page.getByTestId("alerts-count")).toHaveCount(0);
  await page.getByTestId("alerts-bell").click();
  await expect(page.getByTestId("alerts-empty")).toBeVisible();
});

test("dzwonek (konto): lista z API, ukrycie wywołuje POST z zakodowanym kluczem", async ({ page }) => {
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
      total_spent: 0,
      is_custom: false,
    }),
  );
  await signedIn(page); // cookie sesji (znacznik wmt_csrf)

  let items = [
    { key: "GOAL_OVERDUE:g1", code: "GOAL_OVERDUE", level: "critical", state: "2026-09-01", link: "/goals", params: { name: "Wakacje", target_date: "2026-09-01", remaining: 1200 } },
    { key: "WISH_READY:w1", code: "WISH_READY", level: "info", state: "ready", link: "/wishlist", params: { name: "Monitor", price: 900 } },
  ];
  let dismissed = "";
  await page.route("**/api/v1/alerts", (r) => json(r, { items, count: items.length, counts: {} }));
  await page.route("**/api/v1/alerts/**", (r) => {
    dismissed = new URL(r.request().url()).pathname;
    items = items.filter((a) => !dismissed.includes(encodeURIComponent(a.key)) && !dismissed.includes(a.key));
    return json(r, { dismissed: true });
  });

  await page.goto("/budget");
  await expect(page.getByTestId("alerts-count")).toHaveText("2");
  await page.getByTestId("alerts-bell").click();
  const list = page.getByRole("list", { name: "Lista alertów" });
  // pilne na początku listy
  await expect(list.locator("li").first()).toHaveAttribute("data-level", "critical");
  await expect(page.getByTestId("alert-GOAL_OVERDUE:g1")).toContainText("Cel „Wakacje” po terminie");
  await expect(page.getByTestId("alert-WISH_READY:w1")).toContainText("Czas na decyzję: Monitor");

  await page.getByRole("button", { name: /Ukryj alert: Czas na decyzję/ }).click();
  await expect.poll(() => dismissed).toContain("/api/v1/alerts/WISH_READY");
  await expect(page.getByTestId("alert-WISH_READY:w1")).toHaveCount(0);
  await expect(page.getByTestId("alerts-count")).toHaveText("1");
});
