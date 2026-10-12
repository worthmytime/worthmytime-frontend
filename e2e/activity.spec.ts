import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

// godziny w historii pokazujemy w czasie lokalnym użytkownika
test.use({ timezoneId: "Europe/Warsaw" });

const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };

async function asLoggedIn(page: Page) {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: zero,
      loans: [],
      monthly_loans: 0,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      monthly_income: 7000,
      total_spent: 0,
      is_custom: false,
    }),
  );
  await signedIn(page);
}

test("historia zdarzeń: importy z nazwą pliku, datą i godziną oraz cofnięcie konkretnego importu", async ({ page }) => {
  await asLoggedIn(page);
  let imports = [
    { id: "b2", file_name: "wyciag-pazdziernik.xlsx", imported_at: "2026-10-13T08:15:00+00:00", created: 12, skipped: 3, total: 1845.5, remaining: 12, undone_at: null as string | null },
    { id: "b1", file_name: "historia.csv", imported_at: "2026-10-01T16:40:00+00:00", created: 5, skipped: 0, total: 300, remaining: 4, undone_at: null as string | null },
  ];
  const deleted: string[] = [];
  await page.route("**/api/v1/imports", (r) => json(r, { items: imports }));
  await page.route("**/api/v1/imports/*", (r) => {
    const id = new URL(r.request().url()).pathname.split("/").pop()!;
    deleted.push(`${r.request().method()} ${id}`);
    imports = imports.map((b) => (b.id === id ? { ...b, remaining: 0, undone_at: "2026-10-13T09:00:00+00:00" } : b));
    return json(r, { deleted: 12, ...imports.find((b) => b.id === id) });
  });

  await page.goto("/activity");
  const recent = page.getByTestId("import-b2");
  await expect(recent).toContainText("wyciag-pazdziernik.xlsx"); // nazwa z rozszerzeniem
  await expect(recent).toContainText("13 października 2026");
  await expect(recent).toContainText("10:15"); // 08:15 UTC w czasie polskim
  await expect(recent).toContainText(/dopisano 12 wpisów na 1\s845,50\szł/);
  await expect(recent).toContainText("pominięto 3");
  await expect(page.getByTestId("import-b1")).toContainText("historia.csv");
  await expect(page.getByTestId("import-b1")).toContainText("zostało 4 z 5"); // jeden wpis usunięto ręcznie

  // cofnięcie pyta o potwierdzenie i mówi, ile wpisów zniknie; anulowanie niczego nie zmienia
  await recent.getByRole("button", { name: /Cofnij import wyciag-pazdziernik\.xlsx/ }).click();
  const confirm = page.getByRole("group", { name: "Potwierdź cofnięcie importu: wyciag-pazdziernik.xlsx" });
  await expect(confirm).toContainText("12 wpisów");
  await confirm.getByRole("button", { name: "Anuluj" }).click();
  await expect(confirm).toHaveCount(0);
  expect(deleted).toEqual([]);

  await recent.getByRole("button", { name: /Cofnij import wyciag-pazdziernik\.xlsx/ }).click();
  await page.getByRole("group", { name: /Potwierdź cofnięcie importu/ }).getByRole("button", { name: "Tak, cofnij import" }).click();
  await expect(page.getByText("Import cofnięty: z rejestru usunięto 12 wpisów")).toBeVisible();
  expect(deleted).toEqual(["DELETE b2"]);
  await expect(recent).toContainText("cofnięty 13 października 2026");
  await expect(recent.getByRole("button", { name: /Cofnij import/ })).toHaveCount(0);
  // drugi import zostaje nietknięty
  await expect(page.getByTestId("import-b1").getByRole("button", { name: /Cofnij import historia\.csv/ })).toBeEnabled();
});

test("historia zdarzeń: pusta lista i wymóg konta", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/activity");
  await expect(page.getByText("Historia zdarzeń jest dostępne po zalogowaniu.")).toBeVisible();
});

test("import na koncie wysyła nazwę pliku i podpowiada, gdzie go cofnąć", async ({ page }) => {
  await asLoggedIn(page);
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await page.route("**/api/v1/recurring-expenses**", (r) => json(r, { items: [], monthly_total: 0 }));
  await page.route("**/api/v1/expenses**", (r) =>
    json(r, r.request().url().includes("summary") ? { months: [] } : { month: "2026-10", items: [], totals: zero, total: 0, loan_payments: 0 }),
  );
  let sent: { file_name?: string; items: unknown[] } | undefined;
  await page.route("**/api/v1/expenses/import", (r) => {
    sent = r.request().postDataJSON();
    return json(r, { created: 2, skipped: 0, batch_id: "b9" }, 201);
  });

  await page.goto("/expenses");
  await page.getByTestId("import-file").setInputFiles(path.join(__dirname, "fixtures", "bank.txt"));
  for (const merchant of ["PIEKARNIA", "APTEKA"]) {
    await page.getByTestId(`import-group-${merchant}`).getByRole("radio", { name: "Potrzeby" }).click();
  }
  await page.getByTestId("import-submit").click();

  await expect(page.getByText("Zaimportowano 2 wydatków")).toBeVisible();
  await expect(page.getByText("Ten import możesz cofnąć w zakładce Zdarzenia.")).toBeVisible();
  expect(sent?.file_name).toBe("bank.txt");
  expect(sent?.items).toHaveLength(2);
});
