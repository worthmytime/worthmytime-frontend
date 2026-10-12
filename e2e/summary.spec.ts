import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

const zero = { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 };

const category = (name: string, budget: number, spent: number, previous: number) => ({
  category: name,
  budget,
  spent,
  available: budget - spent,
  usage_percent: Math.round((spent / budget) * 1000) / 10,
  previous,
  change: spent - previous,
  change_percent: previous > 0 ? Math.round(((spent - previous) / previous) * 1000) / 10 : null,
});

/** Październik: 2 200 zł wydane (miesiąc wcześniej 250 zł); wrzesień: tylko 250 zł w Przyjemnościach. */
const REPORTS: Record<string, unknown> = {
  "2026-10": {
    month: "2026-10",
    previous_month: "2026-09",
    currency: "PLN",
    monthly_income: 7000,
    categories: [category("NEEDS", 3500, 1200, 0), category("FUTURE", 1750, 500, 0), category("GOALS", 1050, 0, 0), category("FUN", 700, 500, 250)],
    total_spent: 2200,
    previous: 250,
    change: 1950,
    change_percent: 780,
    saved: { future: 500, unspent: 4800 },
    discretionary: { spent: 500, work_hours: 12.4 },
    largest_expense: { id: "e1", category: "NEEDS", amount: 1200, note: "czynsz", spent_on: "2026-10-02" },
    entries: 4,
  },
  "2026-09": {
    month: "2026-09",
    previous_month: "2026-08",
    currency: "PLN",
    monthly_income: 7000,
    categories: [category("NEEDS", 3500, 0, 0), category("FUTURE", 1750, 0, 0), category("GOALS", 1050, 0, 0), category("FUN", 700, 250, 0)],
    total_spent: 250,
    previous: 0,
    change: 250,
    change_percent: null,
    saved: { future: 0, unspent: 6750 },
    discretionary: { spent: 250, work_hours: 6.2 },
    largest_expense: null,
    entries: 1,
  },
};

test("podsumowanie miesiąca (konto): liczby, kategorie, wybór miesiąca i eksport", async ({ page }) => {
  const asked: string[] = [];
  const exported: string[] = [];
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
  await page.route("**/api/v1/reports/month**", (r) => {
    const month = new URL(r.request().url()).searchParams.get("month") ?? "";
    asked.push(month);
    return json(r, REPORTS[month]);
  });
  await page.route("**/api/v1/export**", (r) => {
    const params = new URL(r.request().url()).searchParams;
    exported.push([params.get("format"), params.get("from"), params.get("to")].filter(Boolean).join(" "));
    return r.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: "type,id\r\nexpense,e1\r\n" });
  });
  await signedIn(page);
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await page.goto("/summary");

  await expect(page.getByTestId("summary-month")).toHaveText(/październik 2026/i);
  await expect(page.getByTestId("card-total")).toContainText(/2\s200,00\szł/);
  await expect(page.getByTestId("card-total")).toContainText(/\+1\s950,00\szł/);
  await expect(page.getByTestId("card-unspent")).toContainText(/4\s800,00\szł/);
  await expect(page.getByTestId("card-hours")).toContainText("12,4 h");
  await expect(page.getByTestId("card-largest")).toContainText("czynsz");
  await expect(page.getByTestId("summary-FUN")).toContainText(/500,00\szł \/ 700,00\szł/);
  await expect(page.getByTestId("summary-FUN")).toContainText("(71%)");
  await expect(page.getByTestId("summary-FUN")).toContainText("(+100%)");
  await expect(page.getByRole("button", { name: "Następny miesiąc" })).toBeDisabled(); // nie wychodzimy poza bieżący miesiąc

  // poprzedni miesiąc: nowe zapytanie i liczby tego miesiąca
  await page.getByRole("button", { name: "Poprzedni miesiąc" }).click();
  await expect(page.getByTestId("summary-month")).toHaveText(/wrzesień 2026/i);
  await expect(page.getByTestId("card-total")).toContainText(/250,00\szł/);
  await expect(page.getByTestId("card-total")).toContainText("miesiąc wcześniej bez wydatków");
  await expect(page.getByTestId("card-largest")).toContainText("brak");
  expect(asked).toEqual(["2026-10", "2026-09"]);
  await expect(page.getByRole("button", { name: "Następny miesiąc" })).toBeEnabled();

  // eksport: plik pobiera się z nazwą z dzisiejszą datą
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Pobierz CSV" }).click();
  expect((await download).suggestedFilename()).toBe("worthmytime-2026-10-10.csv");
  expect(exported).toEqual(["csv"]);

  // zakres: wybrany miesiąc (na stronie jest wrzesień), rok, bieżący tydzień i własny przedział
  const pick = async (range: string, button: string) => {
    await page.getByRole("radio", { name: range }).click();
    const started = page.waitForEvent("download");
    await page.getByRole("button", { name: button }).click();
    return (await started).suggestedFilename();
  };
  expect(await pick("Wybrany miesiąc", "Pobierz JSON")).toBe("worthmytime-2026-09-01_2026-09-30.json");
  await expect(page.getByTestId("export-range")).toHaveText("Zakres: 2026-09-01 - 2026-09-30");
  expect(await pick("Rok", "Pobierz CSV")).toBe("worthmytime-2026-01-01_2026-12-31.csv");
  expect(await pick("Ten tydzień", "Pobierz CSV")).toBe("worthmytime-2026-10-05_2026-10-11.csv"); // 10.10.2026 to sobota

  await page.getByRole("radio", { name: "Własny zakres" }).click();
  await page.getByLabel("Od").fill("2026-03-01");
  await page.getByLabel("Do").fill("2026-02-01");
  await expect(page.getByTestId("export-range")).toContainText("nie może być późniejszy");
  await page.getByLabel("Do").fill("2026-03-15");
  const started = page.waitForEvent("download");
  await page.getByRole("button", { name: "Pobierz CSV" }).click();
  expect((await started).suggestedFilename()).toBe("worthmytime-2026-03-01_2026-03-15.csv");
  expect(exported.slice(1)).toEqual([
    "json 2026-09-01 2026-09-30",
    "csv 2026-01-01 2026-12-31",
    "csv 2026-10-05 2026-10-11",
    "csv 2026-03-01 2026-03-15",
  ]);
});

test("podsumowanie miesiąca (bez konta): zachęta do logowania", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/summary");
  await expect(page.getByText("Podsumowanie miesiąca jest dostępne po zalogowaniu.")).toBeVisible();
});
