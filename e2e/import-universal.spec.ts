import path from "node:path";
import { expect, test } from "@playwright/test";
import { json, withLocalProfile } from "./mocks";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

/**
 * bank.csv: historia z innego banku niż iPKO (średniki, daty DD.MM.RRRR, kwoty z przecinkiem, dwie linie nad nagłówkiem).
 * 4 wydatki w PLN (2x LIDL, ORLEN, NETFLIX), 1 wpływ i 1 transakcja w EUR.
 */

test("import z dowolnego banku: Jev dopasowuje kolumny i proponuje kategorie, wydatki trafiają do rejestru", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  let columns: { index: number; header: string; samples: string[] }[] = [];
  let merchants: { key: string; description: string }[] = [];
  await page.route("**/api/map-columns", (r) => {
    columns = r.request().postDataJSON().columns;
    return json(r, { mapping: { date: 0, amount: 3, description: 1, currency: 4 } });
  });
  await page.route("**/api/categorize", (r) => {
    merchants = r.request().postDataJSON().items;
    return json(r, { suggestions: { ORLEN: "NEEDS", "LIDL WARSZAWA": "NEEDS", "NETFLIX.COM": "FUN" } });
  });
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(fixture("bank.csv"));
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toContainText("4 wydatków");
  await expect(dialog).toContainText("pominięto 1 wpływów");
  await expect(dialog).toContainText("1 transakcji w innej walucie");

  // do Jev idą nagłówki i trzy przykładowe wiersze (linie nad nagłówkiem są pomijane)
  expect(columns.map((c) => c.header)).toEqual(["Data operacji", "Opis operacji", "Rodzaj", "Kwota", "Waluta", "Saldo po operacji"]);
  expect(columns[0].samples).toEqual(["05.10.2026", "06.10.2026", "06.10.2026"]);
  expect(columns[3].samples).toEqual(["-45,20", "-210,00", "-43,00"]);

  // dopasowanie widać w oknie i można je poprawić
  const mapping = page.getByTestId("import-mapping");
  await expect(page.getByTestId("import-mapped-by")).toContainText("dopasował Jev");
  await expect(mapping.getByLabel("Data")).toHaveValue("0");
  await expect(mapping.getByLabel("Kwota")).toHaveValue("3");
  await expect(mapping.getByLabel("Opis / sprzedawca")).toHaveValue("1");
  await expect(mapping.getByLabel("Waluta")).toHaveValue("4");
  await expect(mapping).toContainText("Kwoty ujemne traktujemy jako wydatki");

  // kategorie zaproponował Jev od razu po wczytaniu, dla sprzedawców zgrupowanych bez numerów sklepów
  expect(merchants.map((m) => m.key).sort()).toEqual(["LIDL WARSZAWA", "NETFLIX.COM", "ORLEN"]);
  await expect(page.getByTestId("import-group-ORLEN").getByRole("radio", { name: "Potrzeby" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("import-group-LIDL WARSZAWA")).toContainText("2 transakcji");
  await expect(page.getByTestId("import-proposed")).toHaveCount(3);
  await expect(page.getByTestId("import-summary")).toContainText(/Zaimportujemy 4 wydatków na 328,30/);

  // kliknięcie kategorii potwierdza albo zmienia propozycję
  await page.getByTestId("import-group-NETFLIX.COM").getByRole("radio", { name: "Przyjemności" }).click();
  await expect(page.getByTestId("import-proposed")).toHaveCount(2);

  await page.getByTestId("import-submit").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("usage-NEEDS")).toContainText(/285,30/); // 45,20 + 30,10 + 210,00
  await expect(page.getByTestId("usage-FUN")).toContainText(/43,00/);
  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("expense-list-NEEDS")).toContainText("LIDL 123 WARSZAWA");
});

test("import z dowolnego banku bez Jev: kolumny dopasowane po nagłówkach, ręczna poprawka przelicza wydatki", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.route("**/api/map-columns", (r) => json(r, { error: "brak klucza" }, 500));
  await page.route("**/api/categorize", (r) => json(r, { error: "brak klucza" }, 500));
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(fixture("bank.csv"));
  const dialog = page.getByTestId("import-dialog");
  const mapping = page.getByTestId("import-mapping");
  await expect(page.getByTestId("import-mapped-by")).toContainText("Jev nie odpowiedział");
  await expect(dialog).toContainText("4 wydatków");
  await expect(mapping.getByLabel("Kwota")).toHaveValue("3"); // "Kwota", a nie "Saldo po operacji"
  await expect(mapping.getByLabel("Opis / sprzedawca")).toHaveValue("1");
  await expect(page.getByTestId("import-summary")).toContainText("Do przypisania: 3"); // bez Jev kategorie wybiera użytkownik

  // inna kolumna opisu: transakcje grupują się po rodzaju operacji
  await mapping.getByLabel("Opis / sprzedawca").selectOption({ label: "Rodzaj" });
  await expect(page.getByTestId("import-group-PŁATNOŚĆ KARTĄ")).toContainText("4 transakcji");
  // bez kolumny waluty transakcja w EUR przestaje być pomijana
  await mapping.getByLabel("Waluta").selectOption({ label: "brak w pliku" });
  await expect(dialog).toContainText("5 wydatków");
});

test("import arkusza XLSX: daty z arkusza, kolumna obciążeń bez znaku minus", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.route("**/api/map-columns", (r) => json(r, { error: "brak klucza" }, 500));
  await page.route("**/api/categorize", (r) => json(r, { error: "brak klucza" }, 500));
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(fixture("bank.xlsx"));
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toContainText("3 wydatków");
  const mapping = page.getByTestId("import-mapping");
  await expect(mapping.getByLabel("Data")).toHaveValue("0");
  await expect(mapping.getByLabel("Kwota")).toHaveValue("2");
  await expect(mapping).toContainText("każdy wiersz traktujemy jako wydatek");

  const lidl = page.getByTestId("import-group-LIDL");
  await lidl.getByRole("radio", { name: "Potrzeby" }).click();
  await lidl.getByText("Pokaż transakcje").click();
  await expect(lidl).toContainText("2026-10-05"); // data zapisana w arkuszu jako liczba z formatem daty
  await expect(lidl).toContainText(/45,20\szł/);
  await page.getByTestId("import-group-ORLEN").getByRole("radio", { name: "Potrzeby" }).click();
  await page.getByTestId("import-group-NETFLIX.COM").getByRole("radio", { name: "Pomiń" }).click();
  await expect(page.getByTestId("import-summary")).toContainText(/Zaimportujemy 2 wydatków na 255,20/);
});

test("import pliku TXT z tabulatorami i kwotami z walutą", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.route("**/api/map-columns", (r) => json(r, { error: "brak klucza" }, 500));
  await page.route("**/api/categorize", (r) => json(r, { error: "brak klucza" }, 500));
  await page.goto("/expenses");

  await page.getByTestId("import-file").setInputFiles(fixture("bank.txt"));
  await expect(page.getByTestId("import-dialog")).toContainText("2 wydatków");
  await expect(page.getByTestId("import-group-PIEKARNIA")).toContainText(/12,50\szł/);
  await expect(page.getByTestId("import-group-APTEKA")).toContainText(/34,00\szł/);
});
