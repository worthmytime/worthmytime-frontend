import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, RESULT, signedIn } from "./mocks";

/** Zalogowany użytkownik z budżetem: w Przyjemnościach zostało 500 zł, w Celach 1 050 zł, w Przyszłości 1 750 zł. */
async function asLoggedIn(page: Page) {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 200 },
      loans: [],
      monthly_loans: 0,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 500 },
      monthly_income: 7000,
      total_spent: 200,
      is_custom: false,
    }),
  );
  await signedIn(page);
}

test("lista życzeń: zakup pyta o dopisanie do wydatków, pokazuje wpływ na budżet i daje się cofnąć", async ({ page }) => {
  await asLoggedIn(page);
  const work = { ...RESULT.work, hours: 9.9 };
  let items = [
    { id: "w1", name: "Słuchawki", price: 400, category: "FUN", cooldown_days: 0, status: "WAITING", created_at: "2026-09-01T10:00:00Z", decided_at: null as string | null, ready_at: "2026-09-01T10:00:00Z", days_left: 0, ready: true, work },
  ];
  const calls: { method: string; body: Record<string, unknown> | null }[] = [];
  await page.route("**/api/v1/wishlist", (r) =>
    json(r, { items, stats: { dropped_count: 0, dropped_total: 0, dropped_hours: 0, waiting_count: 1, waiting_total: 400, ready_count: 1 }, currency: "PLN" }),
  );
  await page.route("**/api/v1/wishlist/w1/decision", (r) => {
    const method = r.request().method();
    calls.push({ method, body: method === "POST" ? r.request().postDataJSON() : null });
    items = items.map((i) => (method === "POST" ? { ...i, status: "BOUGHT", decided_at: "2026-10-10T10:00:00Z", ready: false } : { ...i, status: "WAITING", decided_at: null, ready: true }));
    return json(r, items[0]);
  });

  await page.goto("/wishlist");
  const card = page.getByTestId("wish-w1");
  await card.getByRole("button", { name: "Kupuję" }).click();
  const confirm = page.getByRole("group", { name: "Potwierdź zakup: Słuchawki" });
  await expect(confirm.getByRole("checkbox")).toBeChecked(); // domyślnie dopisujemy do wydatków
  await expect(confirm.getByRole("radio", { name: "Przyjemności" })).toHaveAttribute("aria-checked", "true"); // kategoria pozycji
  await expect(confirm.getByTestId("buy-impact")).toContainText(/zostanie 100,00\szł z 500,00\szł/);
  expect(calls).toEqual([]); // samo kliknięcie "Kupuję" niczego jeszcze nie zapisuje

  // inna kategoria zmienia podpowiedź; odznaczenie pola mówi, że wpisu nie będzie
  await confirm.getByRole("radio", { name: "Cele" }).click();
  await expect(confirm.getByTestId("buy-impact")).toContainText(/zostanie 650,00\szł z 1\s050,00\szł/);
  await confirm.getByRole("checkbox").uncheck();
  await expect(confirm.getByTestId("buy-impact")).toContainText("bez wpisu w rejestrze");
  await confirm.getByRole("checkbox").check();

  await confirm.getByRole("button", { name: "Potwierdź zakup" }).click();
  await expect(page.getByText("Zapisano jako kupione i dopisano do wydatków")).toBeVisible();
  expect(calls[0]).toEqual({ method: "POST", body: { decision: "BOUGHT", add_expense: true, category: "GOALS" } });

  // cofnięcie decyzji w sekcji Rozstrzygnięte
  await page.getByRole("button", { name: "Cofnij decyzję: Słuchawki" }).click();
  await expect(page.getByText("Zakup cofnięty, wydatek usunięty z rejestru")).toBeVisible();
  expect(calls[1]).toEqual({ method: "DELETE", body: null });
  await expect(page.getByTestId("wish-w1").getByRole("button", { name: "Kupuję" })).toBeVisible();
});

test("lista życzeń: zakup ponad dostępne środki ostrzega, a bez dopisywania wysyła add_expense=false", async ({ page }) => {
  await asLoggedIn(page);
  const work = { ...RESULT.work, hours: 61.9 };
  const item = { id: "w1", name: "PlayStation", price: 2500, category: null, cooldown_days: 0, status: "WAITING", created_at: "2026-09-01T10:00:00Z", decided_at: null, ready_at: "2026-09-01T10:00:00Z", days_left: 0, ready: true, work };
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/v1/wishlist", (r) =>
    json(r, { items: [item], stats: { dropped_count: 0, dropped_total: 0, dropped_hours: 0, waiting_count: 1, waiting_total: 2500, ready_count: 1 }, currency: "PLN" }),
  );
  await page.route("**/api/v1/wishlist/w1/decision", (r) => {
    sent = r.request().postDataJSON();
    return json(r, { ...item, status: "BOUGHT" });
  });

  await page.goto("/wishlist");
  await page.getByTestId("wish-w1").getByRole("button", { name: "Kupuję" }).click();
  const confirm = page.getByRole("group", { name: "Potwierdź zakup: PlayStation" });
  // pozycja bez kategorii: domyślnie Przyjemności, a 2 500 zł to o 2 000 zł więcej niż dostępne 500 zł
  await expect(confirm.getByTestId("buy-impact")).toContainText(/przekroczy dostępne środki kategorii Przyjemności o 2\s000,00\szł/);
  await confirm.getByRole("checkbox").uncheck();
  await confirm.getByRole("button", { name: "Potwierdź zakup" }).click();
  await expect(page.getByText("Zapisano jako kupione", { exact: true })).toBeVisible();
  expect(sent).toEqual({ decision: "BOUGHT", add_expense: false });
});

test("cele: wpłata domyślnie dopisuje wydatek, wypłata nie, a historia pozwala cofnąć wpłatę", async ({ page }) => {
  await asLoggedIn(page);
  const goal = {
    id: "g1", name: "Poduszka", category: null, target_amount: 5000, saved_amount: 500, monthly_contribution: null, target_date: null,
    remaining: 4500, percent: 10, completed: false, months_to_goal: null, eta: null, required_monthly: null, on_track: null, work_hours_remaining: 111.4,
  };
  let deposits = [{ id: "d1", amount: 500, deposited_on: "2026-10-01", in_ledger: true }];
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/goals", (r) => json(r, { items: [goal], currency: "PLN" }));
  await page.route("**/api/v1/goals/g1/deposit", (r) => {
    bodies.push(r.request().postDataJSON());
    return json(r, goal);
  });
  await page.route("**/api/v1/goals/g1/deposits**", (r) => {
    const req = r.request();
    if (req.method() === "DELETE") {
      calls.push(`DELETE ${new URL(req.url()).pathname.replace("/api/v1", "")}`);
      deposits = [];
      return json(r, goal);
    }
    return json(r, { items: deposits, total: 500 });
  });

  await page.goto("/goals");
  const card = page.getByTestId("goal-g1");
  await expect(card.getByRole("checkbox")).toBeChecked();
  await expect(card.getByRole("checkbox")).toHaveAccessibleName(/Dopisz wpłatę do wydatków \(Przyszłość\)/); // cel bez kategorii

  await card.getByLabel("Kwota wpłaty: Poduszka").fill("250");
  await expect(card.getByTestId("deposit-impact")).toContainText(/zostanie 1\s500,00\szł/); // 1 750 zł - 250 zł
  await card.getByRole("button", { name: "Wpłać" }).click();
  await expect(page.getByText("Wpłata dopisana, także do wydatków")).toBeVisible();

  await card.getByRole("checkbox").uncheck();
  await card.getByLabel("Kwota wpłaty: Poduszka").fill("100");
  await card.getByRole("button", { name: "Wpłać" }).click();
  await expect(page.getByText("Wpłata dopisana", { exact: true })).toBeVisible();

  await card.getByLabel("Kwota wpłaty: Poduszka").fill("50");
  await card.getByRole("button", { name: "Wypłać" }).click();
  await expect(page.getByText("Wypłata zapisana")).toBeVisible();
  expect(bodies).toEqual([{ amount: 250, add_expense: true }, { amount: 100, add_expense: false }, { amount: -50 }]);

  // historia wpłat z oznaczeniem wpisu w rejestrze i cofnięciem
  await card.getByRole("button", { name: "Historia wpłat" }).click();
  const history = card.getByTestId("deposit-history");
  await expect(history).toContainText("w wydatkach");
  await expect(history).toContainText(/\+500,00\szł/);
  await history.getByRole("button", { name: /Cofnij wpłatę 500,00/ }).click();
  await expect(page.getByText("Wpłata cofnięta, wydatek usunięty z rejestru")).toBeVisible();
  expect(calls).toEqual(["DELETE /goals/g1/deposits/d1"]);
  await expect(card.getByText("Brak wpłat.")).toBeVisible();
});
