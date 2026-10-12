import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

test("strona główna bez profilu: przykład dla przykładowej stawki i zachęta bez rejestracji", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-account-note")).toContainText("Bez rejestracji");
  await expect(page.getByTestId("home-rate")).toHaveText(/pracy przy stawce 57,69\szł\/h/);
  await expect(page.getByRole("group", { name: "Przykładowy wynik" })).toContainText("43,3");
});

test("strona główna z profilem: przykład liczony z własnej stawki", async ({ page }) => {
  await withLocalProfile(page); // 7 000 zł netto, 8 h dziennie, 5 dni w tygodniu: 40,38 zł/h
  await page.goto("/");
  const example = page.getByRole("group", { name: "Przykład dla Twojej stawki" });
  await expect(page.getByTestId("home-rate")).toHaveText(/pracy przy Twojej stawce 40,38\szł\/h/);
  await expect(example).toContainText("61,9"); // 2 500 zł / 40,38 zł/h
  await expect(example).toContainText("To 36% Twojej miesięcznej wypłaty"); // 2 500 / 7 000
});

test("strona główna po zalogowaniu nie zachęca do korzystania bez rejestracji", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, { percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 }, spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, loans: [], is_custom: false, amounts: null, available: null, monthly_income: null, total_spent: 0 }),
  );
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByTestId("home-account-note")).toContainText("Jesteś zalogowany");
  await expect(page.getByTestId("home-account-note")).not.toContainText("Bez rejestracji");
});

test("budżet: priorytety 1-4 bez luki, a powiadomienie nie zasłania paska nawigacji", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/budget");
  const priorities = [];
  for (const c of ["NEEDS", "FUTURE", "GOALS", "FUN"]) {
    priorities.push((await page.getByTestId(`budget-${c}`).locator("span", { hasText: /^P\d$/ }).first().textContent())?.trim());
  }
  expect(priorities).toEqual(["P1", "P2", "P3", "P4"]);

  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toContainText("Budżet zapisany");
  const header = await page.locator("header").first().boundingBox();
  const box = await toast.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height); // pod paskiem, nie na nim
});
