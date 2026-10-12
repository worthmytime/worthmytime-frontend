import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

/** Dopisuje wydatek z formularza i zostawia rozwiniętą kategorię (budżet Przyjemności przy dochodzie 7 000 zł to 700 zł). */
async function addFun(page: Page, amount: string, note: string) {
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Kwota").fill(amount);
  await page.getByLabel("Notatka (opcjonalnie)").fill(note);
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByTestId("expense-list-FUN")).toContainText(note);
}

test("edycja wpisu (bez konta): zmiana kwoty i notatki przelicza zużycie budżetu", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await addFun(page, "200", "kino");
  await expect(page.getByTestId("usage-FUN")).toContainText("29%"); // 200 / 700

  await page.getByRole("button", { name: "Edytuj wydatek kino" }).click();
  const form = page.getByTestId("expense-edit-form");
  await form.getByLabel("Kwota wpisu").fill("350");
  await form.getByLabel("Notatka wpisu").fill("kino i popcorn");
  await form.getByRole("button", { name: "Zapisz" }).click();

  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("expense-list-FUN")).toContainText("kino i popcorn");
  await expect(page.getByTestId("usage-FUN")).toContainText("50%"); // 350 / 700
  await expect(page.getByTestId("expense-list-FUN").locator("li")).toHaveCount(1); // edycja nie dopisuje drugiego wpisu
});

test("edycja zmienia kategorię: wpis przechodzi do innej kategorii", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await addFun(page, "100", "czynsz za garaż");

  await page.getByRole("button", { name: "Edytuj wydatek czynsz za garaż" }).click();
  await page.getByTestId("expense-edit-form").getByLabel("Kategoria wpisu").selectOption("NEEDS");
  await page.getByTestId("expense-edit-form").getByRole("button", { name: "Zapisz" }).click();

  await expect(page.getByTestId("usage-FUN")).toContainText("0 wpisów");
  await expect(page.getByTestId("usage-NEEDS")).toContainText("1 wpis");
});

test("edycja: anulowanie zostawia wpis bez zmian, a zła kwota pokazuje błąd przy polu", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await addFun(page, "200", "kino");

  await page.getByRole("button", { name: "Edytuj wydatek kino" }).click();
  const form = page.getByTestId("expense-edit-form");
  await form.getByLabel("Kwota wpisu").fill("0");
  await form.getByRole("button", { name: "Zapisz" }).click();
  await expect(form).toContainText("Podaj kwotę większą od zera");

  await form.getByLabel("Kwota wpisu").fill("999");
  await form.getByRole("button", { name: "Anuluj" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("expense-list-FUN")).toContainText("200,00");
});

test("wpis raty kredytu nie ma edycji (tylko usuwanie), zwykły wpis ma", async ({ page }) => {
  await withLocalProfile(page);
  await page.addInitScript(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    window.localStorage.setItem(
      "wmt_ledger",
      JSON.stringify([
        { id: "l1", category: "NEEDS", amount: 800, note: "Rata: Kredyt auto", spent_on: today, source_type: "LOAN", source_id: "local:Kredyt auto" },
        { id: "m1", category: "NEEDS", amount: 30, note: "bułki", spent_on: today },
      ]),
    );
  });
  await page.goto("/expenses");
  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();

  await expect(page.getByRole("button", { name: "Edytuj wydatek bułki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Usuń wydatek Rata: Kredyt auto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edytuj wydatek Rata: Kredyt auto" })).toHaveCount(0);
});

test("edycja wpisu (konto): PUT /expenses/{id} z nowymi polami, lista odświeża się z API", async ({ page }) => {
  const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };
  let items: Record<string, unknown>[] = [{ id: "e1", category: "FUN", amount: 40, note: "kawa", spent_on: "2026-10-03" }];
  let put: { url: string; body: Record<string, unknown> } | undefined;

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
  await page.route("**/api/v1/recurring-expenses**", (r) => json(r, { items: [], monthly_total: 0 }));
  await page.route("**/api/v1/expenses**", (r) => {
    const req = r.request();
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      put = { url: req.url(), body };
      items = [{ ...items[0], ...body }];
      return json(r, items[0]);
    }
    if (req.url().includes("summary")) return json(r, { months: [] });
    const total = items.reduce((s, e) => s + (e.amount as number), 0);
    return json(r, { month: "2026-10", items, totals: { ...zero, FUN: total }, total, loan_payments: 0 });
  });
  await signedIn(page);
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await page.goto("/expenses");

  await page.getByTestId("usage-FUN").getByRole("button", { expanded: false }).click();
  await page.getByRole("button", { name: "Edytuj wydatek kawa" }).click();
  const form = page.getByTestId("expense-edit-form");
  await form.getByLabel("Kwota wpisu").fill("55,50");
  await form.getByLabel("Notatka wpisu").fill("kawa z mlekiem");
  await form.getByRole("button", { name: "Zapisz" }).click();

  await expect.poll(() => put?.url.endsWith("/expenses/e1")).toBe(true);
  await expect.poll(() => put?.body).toMatchObject({ category: "FUN", amount: 55.5, note: "kawa z mlekiem", spent_on: "2026-10-03" });
  await expect(page.getByTestId("expense-list-FUN")).toContainText("kawa z mlekiem");
  await expect(page.getByTestId("expense-list-FUN")).toContainText("55,50");
});
