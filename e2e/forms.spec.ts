import { expect, test } from "@playwright/test";
import { json, PROFILE, RESULT, SAVED, signedIn, withLocalProfile } from "./mocks";

test("kalkulator: cena w polskim zapisie, bez duplikatów na liście życzeń i Zapisz zmiany dopiero po zmianie", async ({ page }) => {
  let calculated: { calculation: { purchase_price: number } } | undefined;
  let wishes = 0;
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, { percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 }, spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, loans: [], is_custom: false, amounts: null, available: null, monthly_income: null, total_spent: 0 }),
  );
  await page.route("**/api/v1/calculate", (r) => {
    calculated = r.request().postDataJSON();
    return json(r, RESULT);
  });
  await page.route("**/api/v1/wishlist", (r) => {
    wishes += 1;
    return json(r, { id: `w${wishes}` }, 201);
  });
  await page.route("**/api/v1/calculations", (r) => json(r, SAVED, 201));
  await page.route("**/api/v1/calculations/c1", (r) => json(r, SAVED));
  await signedIn(page);
  await page.goto("/calculator");

  await page.getByLabel("Co chcesz kupić?").fill("Słuchawki Sony");
  await page.getByLabel("Cena").fill("1 299,99"); // spacja grupuje tysiące, przecinek oddziela grosze
  await page.getByRole("button", { name: "Oblicz" }).click();
  await expect(page.getByRole("button", { name: "Dodaj do listy życzeń" })).toBeVisible();
  expect(calculated?.calculation.purchase_price).toBe(1299.99);

  // po dodaniu przycisk się blokuje, więc drugi klik nie tworzy duplikatu
  await page.getByRole("button", { name: "Dodaj do listy życzeń" }).click();
  const addedButton = page.getByRole("button", { name: "Dodano do listy życzeń" });
  await expect(addedButton).toBeDisabled();
  await addedButton.click({ force: true });
  expect(wishes).toBe(1);

  // po zapisie w historii "Zapisz zmiany" czeka na zmianę w formularzu
  await page.getByRole("button", { name: "Zapisz w historii" }).click();
  const saveChanges = page.getByRole("button", { name: "Zapisz zmiany" });
  await expect(saveChanges).toBeDisabled();
  await page.getByLabel("Co chcesz kupić?").fill("Słuchawki Sony WH");
  await expect(saveChanges).toBeEnabled();
});

test("kwoty w polskim zapisie: wydatek ze spacją i przecinkiem, raty kredytów z przecinkiem", async ({ page }) => {
  await withLocalProfile(page);
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "wmt_budget",
      JSON.stringify({
        percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
        spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
        loans: [{ name: "Pożyczka", installment_amount: 540.18, installments_left: 12, payment_day: 11, loan_amount: 6482.16 }],
      }),
    ),
  );
  await page.goto("/expenses");
  await page.getByRole("radio", { name: "Cele" }).click();
  await page.getByLabel("Kwota").fill("1 250,50");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByTestId("usage-GOALS")).toContainText(/1\s250,50\szł/);

  // litery to nie kwota: błąd przy polu, bez zapisu
  await page.getByLabel("Kwota").fill("tysiąc");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByText("Podaj kwotę większą od zera")).toBeVisible();

  const loan = page.getByTestId("loan-0");
  await expect(loan.getByLabel("Wysokość raty")).toHaveValue("540,18");
  await expect(loan.getByLabel("Suma kredytu")).toHaveValue("6482,16");
});

test("budżet: pasek zapisu pokazuje stan i sumę, a wyjście z niezapisanymi zmianami wymaga potwierdzenia", async ({ page, isMobile }) => {
  await withLocalProfile(page);
  await page.goto("/budget");
  const status = page.getByTestId("budget-status");
  await expect(status).toHaveText("Wszystkie zmiany zapisane.");
  await expect(page.getByTestId("budget-save-bar")).toBeInViewport(); // widoczny bez przewijania na dół strony

  await page.getByTestId("budget-FUN").getByLabel("Udział w dochodzie (%)").fill("20");
  await expect(status).toHaveText("Suma procentów: 110%, powinno być 100%.");
  await page.getByTestId("budget-NEEDS").getByLabel("Udział w dochodzie (%)").fill("40");
  await expect(status).toHaveText("Masz niezapisane zmiany.");

  // przejście na inną stronę zatrzymuje okno w aplikacji; "Zostań" zostawia nas w Budżecie z wpisanymi wartościami
  const nav = page.getByRole("navigation", { name: isMobile ? "Nawigacja mobilna" : "Główna nawigacja" });
  await nav.getByRole("link", { name: "Wydatki" }).click();
  const leave = page.getByTestId("budget-leave-dialog");
  await expect(leave).toContainText("Masz niezapisane zmiany w budżecie");
  await expect(page).toHaveURL(/\/budget$/);
  await leave.getByRole("button", { name: "Zostań i dokończ" }).click();
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(page.getByTestId("budget-FUN").getByLabel("Udział w dochodzie (%)")).toHaveValue("20");

  // po zapisie nie ma o co pytać
  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  await expect(page.getByText("Budżet zapisany")).toBeVisible();
  await expect(status).toHaveText("Wszystkie zmiany zapisane.");
  await nav.getByRole("link", { name: "Wydatki" }).click();
  await expect(page).toHaveURL(/\/expenses$/);

  // "Wyjdź bez zapisywania" przechodzi dalej i porzuca zmianę
  await page.goto("/budget");
  await page.getByTestId("budget-FUN").getByLabel("Udział w dochodzie (%)").fill("15");
  await page.getByTestId("budget-NEEDS").getByLabel("Udział w dochodzie (%)").fill("45");
  await nav.getByRole("link", { name: "Wydatki" }).click();
  await page.getByTestId("budget-leave-dialog").getByRole("button", { name: "Wyjdź bez zapisywania" }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wmt_budget") ?? "null"));
  expect(saved.percentages.FUN).toBe(20); // zostaje wartość z ostatniego zapisu
});
