import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

const FILE = path.join(__dirname, "fixtures", "ipko.csv");
const NOT_A_STATEMENT = path.join(__dirname, "fixtures", "nie-wyciag.csv");

/** Wyciąg: 9 wydatków w PLN (2x BIEDRONKA, 3x ZABKA, SEOHOST, PLAYER, REVOLUT, UCZELNIA); wpływ i transakcja w USD są pomijane. */
async function chooseCategory(page: Page, group: string, category: string) {
  await page.getByTestId(`import-group-${group}`).getByRole("radio", { name: category }).click();
}

test("import iPKO (bez konta): grupy po sprzedawcy, kategorie w oknie i wpisy w rejestrze", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(FILE);
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toContainText("9 wydatków"); // 11 wierszy minus wpływ i USD; w tym 6 blokad
  await expect(dialog).toContainText("pominięto 1 wpływów");
  await expect(dialog).toContainText("1 transakcji w innej walucie");

  // sprzedawcy zgrupowani bez numerów sklepów i kodów kas
  for (const g of ["JMP S.A. BIEDRONKA", "ZABKA", "REVOLUT", "SEOHOST.PL", "PLAYER.PL", "UCZELNIA ABC"]) {
    await expect(page.getByTestId(`import-group-${g}`)).toBeVisible();
  }
  await expect(page.getByTestId("import-group-ZABKA")).toContainText("3 transakcji");

  // dopóki nie przypiszemy wszystkich, importu nie da się wykonać
  await expect(page.getByTestId("import-submit")).toBeDisabled();
  await expect(page.getByTestId("import-summary")).toContainText("Do przypisania: 6");

  await chooseCategory(page, "JMP S.A. BIEDRONKA", "Potrzeby");
  await chooseCategory(page, "UCZELNIA ABC", "Potrzeby");
  await chooseCategory(page, "ZABKA", "Przyjemności");
  await chooseCategory(page, "PLAYER.PL", "Przyjemności");
  await chooseCategory(page, "SEOHOST.PL", "Cele");
  await page.getByTestId("import-group-REVOLUT").getByRole("radio", { name: "Pomiń" }).click();
  await expect(page.getByTestId("import-submit")).toBeEnabled();
  await expect(page.getByTestId("import-summary")).toContainText(/Zaimportujemy 8 wydatków na 2\s592,65/);

  await page.getByTestId("import-submit").click();
  await expect(dialog).toBeHidden();

  // Potrzeby: 106,88 (Biedronka) + 2 400 (uczelnia) = 2 506,88; Przyjemności: 42,48 (Żabka) + 25 = 67,48; Cele: 18,29
  await expect(page.getByTestId("usage-NEEDS")).toContainText(/2\s506,88/);
  await expect(page.getByTestId("usage-FUN")).toContainText(/67,48/);
  await expect(page.getByTestId("usage-GOALS")).toContainText(/18,29/);

  await page.getByTestId("usage-FUN").getByRole("button", { expanded: false }).click();
  const list = page.getByTestId("expense-list-FUN");
  await expect(list.locator("li")).toHaveCount(4);
  await expect(list).toContainText("ZABKA ZD721 K.1, LUBARTOW");
  await expect(list.getByTestId("expense-source").first()).toHaveText("import");
});

test("import iPKO: zapamiętane kategorie i brak duplikatów przy ponownym imporcie", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(FILE);
  for (const [g, c] of [
    ["JMP S.A. BIEDRONKA", "Potrzeby"],
    ["UCZELNIA ABC", "Potrzeby"],
    ["ZABKA", "Przyjemności"],
    ["PLAYER.PL", "Przyjemności"],
    ["SEOHOST.PL", "Cele"],
    ["REVOLUT", "Przyjemności"],
  ]) {
    await chooseCategory(page, g, c);
  }
  await page.getByTestId("import-submit").click();
  await expect(page.getByTestId("import-dialog")).toBeHidden();
  await expect(page.getByTestId("usage-FUN")).toContainText(/327,00/);

  // drugi import tego samego pliku: kategorie same się przypisały, a wpisy się nie dublują
  await page.getByTestId("import-file").setInputFiles(FILE);
  await expect(page.getByTestId("import-summary")).toContainText("Zaimportujemy 9 wydatków");
  await expect(page.getByTestId("import-submit")).toBeEnabled();
  await page.getByTestId("import-submit").click();
  await expect(page.getByText(/pominięto 9 już istniejących/)).toBeVisible();
  await expect(page.getByTestId("usage-FUN")).toContainText(/327,00/); // bez zmian

  // wpisy z importu przetrwały odświeżenie strony
  await page.reload();
  await expect(page.getByTestId("usage-FUN")).toContainText(/327,00/);
});

test("import iPKO: blokady można wyłączyć, a plik spoza iPKO daje czytelny błąd", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(NOT_A_STATEMENT);
  await expect(page.getByText(/To nie wygląda na wyciąg z iPKO/)).toBeVisible();
  await expect(page.getByTestId("import-dialog")).toBeHidden();

  await page.getByTestId("import-file").setInputFiles(FILE);
  await expect(page.getByTestId("import-dialog")).toContainText("9 wydatków");
  await page.getByTestId("import-pending").uncheck(); // 6 blokad mniej: zostają 3 rozliczone wydatki
  await expect(page.getByTestId("import-group-JMP S.A. BIEDRONKA")).toHaveCount(0);
  await expect(page.getByTestId("import-group-ZABKA")).toContainText("1 transakcja");
  await expect(page.getByTestId("import-group-PLAYER.PL")).toBeVisible();
});

test("import iPKO (konto): wysyła kategoryzowane wydatki do POST /expenses/import", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await signedIn(page);
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
  await page.route("**/api/v1/recurring-expenses**", (r) => json(r, { items: [], monthly_total: 0 }));
  await page.route("**/api/v1/expenses**", (r) =>
    json(r, r.request().url().includes("summary") ? { months: [] } : { month: "2026-10", items: [], totals: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, total: 0, loan_payments: 0 }),
  );
  // trasy w Playwright wygrywają w kolejności odwrotnej do rejestracji, więc szczegółowa musi być dodana po ogólnej
  let sent: { items: { key: string; category: string; amount: number; note: string; spent_on: string }[] } | undefined;
  await page.route("**/api/v1/expenses/import", (r) => {
    sent = r.request().postDataJSON();
    return json(r, { created: sent!.items.length, skipped: 0 }, 201);
  });

  await page.goto("/expenses");
  await page.getByTestId("import-file").setInputFiles(FILE);
  for (const g of ["JMP S.A. BIEDRONKA", "UCZELNIA ABC", "ZABKA", "PLAYER.PL", "SEOHOST.PL", "REVOLUT"]) {
    await chooseCategory(page, g, g === "JMP S.A. BIEDRONKA" ? "Potrzeby" : "Przyjemności");
  }
  await page.getByTestId("import-submit").click();
  await expect.poll(() => sent?.items.length).toBe(9);

  const zabka = sent!.items.filter((i) => i.note.startsWith("ZABKA"));
  expect(zabka).toHaveLength(3);
  expect(zabka.every((i) => i.category === "FUN")).toBe(true);
  const biedronka = sent!.items.find((i) => i.note.startsWith("JMP S.A. BIEDRONKA") && i.amount === 92.41)!;
  expect(biedronka).toMatchObject({ category: "NEEDS", spent_on: "2026-10-06", note: "JMP S.A. BIEDRONKA 336, LUBARTOW" });
  expect(new Set(sent!.items.map((i) => i.key)).size).toBe(9); // klucze unikalne i stabilne
  expect(sent!.items.every((i) => i.key.length >= 8)).toBe(true);
  await expect(page.getByText("Zaimportowano 9 wydatków")).toBeVisible();
});
