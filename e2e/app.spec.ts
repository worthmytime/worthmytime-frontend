import { expect, test } from "@playwright/test";
import { BUDGET_EXCEEDED, BUDGET_PLAN, json, PROFILE, RESULT, SAVED, signedIn, withLocalBudget, withLocalLedger, withLocalProfile } from "./mocks";

test("onboarding profilu, a potem obliczenie zakupu", async ({ page }) => {
  await page.route("**/api/v1/calculate", (r) => json(r, RESULT));

  await page.goto("/calculator");
  await page.getByLabel("Miesięczny dochód netto").fill("7000");
  await expect(page.getByText("40,38")).toBeVisible(); // podgląd efektywnej stawki
  await page.getByRole("button", { name: /Dalej/ }).click();

  await page.getByLabel("Co chcesz kupić?").fill("iPhone 17 Pro");
  await page.getByLabel("Cena").fill("5299");
  await page.getByLabel("Okres użytkowania (lata)").fill("3");
  await page.getByRole("button", { name: "Oblicz" }).click();

  await expect(page.getByTestId("hours")).toContainText("131,2");
  // wypłata -> miesiąc -> lata, w tej kolejności
  await expect(page.getByTestId("income-share")).toContainText("75,7% Twojej miesięcznej wypłaty");
  await expect(page.getByTestId("months")).toContainText("0,76 miesiąca pracy");
  await expect(page.getByTestId("years")).toContainText("0,06 roku pracy");
  const [monthsY, yearsY] = await Promise.all([
    page.getByTestId("months").boundingBox().then((b) => b!.y),
    page.getByTestId("years").boundingBox().then((b) => b!.y),
  ]);
  expect(monthsY).toBeLessThan(yearsY);
  await expect(page.getByText("Gdy używasz tego przez 3 lata")).toBeVisible();
  await expect(page.getByText("aby zapisać wynik w historii")).toBeVisible();
});

test("walidacja formularza pokazuje błędy przy polach", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/calculator");
  await page.getByRole("button", { name: "Oblicz" }).click();
  await expect(page.getByText("Podaj nazwę")).toBeVisible();
  await expect(page.getByText("Podaj cenę")).toBeVisible();
});

test("błąd 422 z API trafia do właściwego pola", async ({ page }) => {
  await withLocalProfile(page);
  await page.route("**/api/v1/calculate", (r) =>
    json(r, { error: "Błąd walidacji danych", errors: [{ field: "calculation.purchase_price", message: "Cena jest za wysoka" }] }, 422),
  );
  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Zamek");
  await page.getByLabel("Cena").fill("999999999");
  await page.getByRole("button", { name: "Oblicz" }).click();
  await expect(page.getByText("Cena jest za wysoka")).toBeVisible();
});

test("koszt cykliczny: wykres i tabela horyzontów", async ({ page }) => {
  await withLocalProfile(page);
  const horizon = (label: string, years: number, cost: number, hours: number, pct: number) => ({
    label,
    years,
    cost,
    work: { ...RESULT.work, hours, hours_part: Math.floor(hours), minutes_part: 0, income_percent: pct },
  });
  await page.route("**/api/v1/calculate", (r) =>
    json(r, {
      ...RESULT,
      name: "Netflix",
      type: "RECURRING",
      total_cost: 49,
      work: { ...RESULT.work, hours: 1.18, hours_part: 1, minutes_part: 11, working_months: 0.01, income_percent: 0.7 },
      life_cost: null,
      breakdown: [{ name: "Netflix", amount: 49, frequency: "MONTHLY" }],
      horizons: [horizon("1 month", 0.0833, 49, 1.18, 0.7), horizon("1 year", 1, 588, 14.1, 8.4), horizon("10 years", 10, 5880, 141.1, 84)],
      summary: { years: 10, working_days: 17.64 },
    }),
  );
  await page.goto("/calculator");
  await page.getByRole("tab", { name: "Cykliczny" }).click();
  await page.getByLabel("Co chcesz kupić?").fill("Netflix");
  await page.getByLabel("Kwota").fill("49");
  await page.getByLabel("Nazwa").fill("Netflix");
  await page.getByRole("button", { name: "Oblicz" }).click();
  // nagłówek = jeden miesiąc, dopiero niżej narastanie w latach
  await expect(page.getByText("kosztuje Cię miesięcznie")).toBeVisible();
  await expect(page.getByTestId("income-share")).toContainText("0,7% Twojej miesięcznej wypłaty");
  await expect(page.getByText("Jak to narasta w czasie")).toBeVisible();
  await expect(page.getByText("W skali lat")).toBeHidden();
  await expect(page.getByText("10 lat tego wydatku to około")).toBeVisible();
});

test("koszt cykliczny: nagłówek to 1 miesiąc nawet gdy API zwróci sumę z 10 lat", async ({ page }) => {
  await withLocalProfile(page);
  const w = (hours: number, pct: number, months: number) => ({ ...RESULT.work, hours, hours_part: Math.floor(hours), minutes_part: 0, working_months: months, income_percent: pct });
  await page.route("**/api/v1/calculate", (r) =>
    json(r, {
      ...RESULT,
      name: "Pensjonat",
      type: "RECURRING",
      total_cost: 216000, // stare API: suma z 10 lat w polu total_cost/work
      work: w(4536, 2700, 27),
      life_cost: null,
      breakdown: [{ name: "Pensjonat", amount: 1800, frequency: "MONTHLY" }],
      horizons: [
        { label: "1 month", years: 0.0833, cost: 1800, work: w(37.8, 22.5, 0.23) },
        { label: "1 year", years: 1, cost: 21600, work: w(453.6, 270, 2.7) },
        { label: "10 years", years: 10, cost: 216000, work: w(4536, 2700, 27) },
      ],
    }),
  );
  await page.goto("/calculator");
  await page.getByRole("tab", { name: "Cykliczny" }).click();
  await page.getByLabel("Co chcesz kupić?").fill("Pensjonat");
  await page.getByLabel("Kwota").fill("1800");
  await page.getByLabel("Nazwa").fill("Pensjonat");
  await page.getByRole("button", { name: "Oblicz" }).click();
  await expect(page.getByTestId("hours")).toContainText("37,8");
  await expect(page.getByTestId("income-share")).toContainText("22,5%");
  await expect(page.getByText("/ miesiąc").first()).toBeVisible();
  await expect(page.getByText("27× wypłaty")).toBeVisible(); // dopiero w sekcji narastania
});

test("rejestracja, zapis w historii i publiczny link", async ({ page }) => {
  let saved = { ...SAVED };
  await page.route("**/api/v1/auth/register", async (r) => {
    await signedIn(page); // serwer ustawia cookie sesji
    return json(r, { token: "t", profile: PROFILE }, 201);
  });
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/calculate", (r) => json(r, RESULT));
  await page.route("**/api/v1/calculations", (r) => json(r, saved, 201));
  await page.route("**/api/v1/calculations/c1", (r) => json(r, saved));
  await page.route("**/api/v1/calculations/c1/share", (r) => {
    saved = { ...saved, public_id: "abc123" };
    return json(r, { public_id: "abc123", path: "/s/abc123" });
  });
  await withLocalProfile(page);

  await page.goto("/profile");
  await page.getByRole("button", { name: /Nie mam konta/ }).click();
  await page.getByLabel("E-mail").fill("a@b.pl");
  await page.getByLabel("Hasło").fill("supersecret1");
  await page.getByRole("button", { name: "Zarejestruj" }).click();
  await expect(page.getByText("Zalogowano jako")).toBeVisible();

  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("iPhone 17 Pro");
  await page.getByLabel("Cena").fill("5299");
  await page.getByRole("button", { name: "Oblicz" }).click();
  await page.getByRole("button", { name: /Zapisz w historii/ }).click();
  await page.getByRole("button", { name: "Udostępnij" }).click();
  await expect(page.getByRole("link", { name: "/s/abc123" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Wyłącz udostępnianie/ })).toBeVisible();
});

test("sesja w cookie: token z odpowiedzi nie trafia do localStorage", async ({ page }) => {
  await page.route("**/api/v1/auth/register", async (r) => {
    // serwer ustawia cookie sesji; przeglądarka (poza skryptami) widzi tylko znacznik wmt_csrf
    await page.context().addCookies([{ name: "wmt_csrf", value: "csrf-z-serwera", domain: "localhost", path: "/" }]);
    return json(r, { token: "nie-zapisuj-mnie", profile: PROFILE }, 201);
  });
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await withLocalProfile(page);

  await page.goto("/profile");
  await page.getByRole("button", { name: /Nie mam konta/ }).click();
  await page.getByLabel("E-mail").fill("a@b.pl");
  await page.getByLabel("Hasło").fill("supersecret1");
  await page.getByRole("button", { name: "Zarejestruj" }).click();
  await expect(page.getByText("Zalogowano jako")).toBeVisible();

  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain("nie-zapisuj-mnie");
  expect(await page.evaluate(() => window.localStorage.getItem("wmt_token"))).toBeNull();

  // po odświeżeniu sesja trwa dzięki cookie (bez tokenu w localStorage)
  await page.reload();
  await expect(page.getByText("Zalogowano jako")).toBeVisible();
});

test("sesja w cookie: wylogowanie wywołuje POST /auth/logout z tokenem CSRF", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) => json(r, { ...BUDGET_PLAN, is_custom: false, amounts: null, available: null, monthly_income: null, total_spent: 0 }));
  let logout: { method: string; csrf?: string } | undefined;
  await page.route("**/api/v1/auth/logout", (r) => {
    logout = { method: r.request().method(), csrf: r.request().headers()["x-csrf-token"] };
    return json(r, { logged_out: true });
  });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Wyloguj" }).first().click();
  await expect.poll(() => logout).toEqual({ method: "POST", csrf: "csrf-test" });
});

test("migracja: token z localStorage zostaje wymieniony na cookie i usunięty z przeglądarki", async ({ page }) => {
  let bearer: string | undefined;
  await page.route("**/api/v1/auth/session", (r) => {
    bearer = r.request().headers()["authorization"];
    return json(r, { profile: PROFILE });
  });
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) => json(r, { ...BUDGET_PLAN, is_custom: false, amounts: null, available: null, monthly_income: null, total_spent: 0 }));
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("seeded")) {
      window.sessionStorage.setItem("seeded", "1");
      window.localStorage.setItem("wmt_token", "stary-token");
    }
  });
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Wyloguj" }).first()).toBeVisible();
  expect(bearer).toBe("Bearer stary-token");
  expect(await page.evaluate(() => window.localStorage.getItem("wmt_token"))).toBeNull();
});

test("historia: filtrowanie i stan pusty", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/calculations", (r) =>
    json(r, { items: [SAVED, { ...SAVED, id: "c2", name: "Rower", type: "TCO" }] }),
  );
  await signedIn(page);
  await page.goto("/history");
  await expect(page.getByText("iPhone 17 Pro")).toBeVisible();
  await page.getByLabel("Szukaj po nazwie").fill("rower");
  await expect(page.getByText("iPhone 17 Pro")).toBeHidden();
  await expect(page.getByText("Rower")).toBeVisible();
});

test("nawigacja i brak poziomego przewijania", async ({ page, isMobile }) => {
  await page.goto("/");
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(0);

  if (isMobile) {
    await expect(page.getByRole("navigation", { name: "Nawigacja mobilna" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Główna nawigacja" })).toBeHidden();
  } else {
    await expect(page.getByRole("navigation", { name: "Główna nawigacja" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Nawigacja mobilna" })).toBeHidden();
  }
});

test("kategoria budżetu: wysyła plan do API i ostrzega, że zakup może się nie mieścić", async ({ page }) => {
  await withLocalProfile(page);
  await withLocalBudget(page);
  await withLocalLedger(page, [{ category: "FUN", amount: 400 }]); // wydane liczy rejestr wydatków
  let sent: { budget?: typeof BUDGET_PLAN; calculation: { category: string; already_saved: number } } | undefined;
  await page.route("**/api/v1/calculate", (r) => {
    sent = r.request().postDataJSON();
    return json(r, { ...RESULT, name: "PlayStation", total_cost: 2500, budget: BUDGET_EXCEEDED });
  });

  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("PlayStation");
  await page.getByLabel("Cena").fill("2500");
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Już odłożone").fill("500");
  await page.getByRole("button", { name: "Oblicz" }).click();

  const card = page.getByTestId("budget-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("warning-CATEGORY_BUDGET_EXCEEDED")).toContainText("To może nie mieścić się w Twoim planie budżetowym");
  await expect(card.getByTestId("warning-CATEGORY_BUDGET_EXCEEDED")).toContainText("290%");
  await expect(card.getByTestId("warning-HIGHER_PRIORITY_AT_RISK")).toBeVisible();
  await expect(card.getByTestId("months-to-goal")).toContainText("2,5 mies.");
  await expect(card).toContainText("Zakup to 250% miesięcznego budżetu „Przyjemności”");

  // do API poszedł plan z przeglądarki (anonimowy użytkownik) oraz kategoria i cel
  expect(sent?.budget?.percentages.FUN).toBe(10);
  expect(sent?.budget?.spent.FUN).toBe(400);
  expect(sent?.calculation.category).toBe("FUN");
  expect(sent?.calculation.already_saved).toBe(500);
});

test("zakup mieszczący się w budżecie nie dostaje ostrzeżenia o przekroczeniu", async ({ page }) => {
  await withLocalProfile(page);
  await page.route("**/api/v1/calculate", (r) =>
    json(r, {
      ...RESULT,
      budget: {
        ...BUDGET_EXCEEDED,
        fits_budget: true,
        warnings: [{ code: "NO_BUDGET_DATA", level: "info", params: {} }],
        upfront: { ...BUDGET_EXCEEDED.upfront, cost: 100, projected_usage_percent: 50, purchase_share_percent: 10 },
      },
    }),
  );
  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Książka");
  await page.getByLabel("Cena").fill("100");
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByRole("button", { name: "Oblicz" }).click();
  const card = page.getByTestId("budget-card");
  await expect(card).toHaveAttribute("data-fits", "true");
  await expect(card.getByTestId("warning-CATEGORY_BUDGET_EXCEEDED")).toHaveCount(0);
  await expect(card.getByTestId("warning-NO_BUDGET_DATA")).toContainText("domyślnego budżetu");
});

test("strona budżetu: walidacja sumy 100% i zapis planu", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/budget");
  await expect(page.getByTestId("pct-sum")).toHaveText("100%");

  await page.getByTestId("budget-FUN").getByLabel("Udział w dochodzie (%)").fill("20");
  await expect(page.getByTestId("pct-sum")).toHaveText("110%");
  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  await expect(page.getByText("Procenty muszą sumować się do 100")).toBeVisible();

  await page.getByTestId("budget-NEEDS").getByLabel("Udział w dochodzie (%)").fill("40");
  // "wydane" nie jest już polem budżetu - liczy je rejestr wydatków
  await expect(page.getByTestId("budget-FUN").getByLabel("Wydane w tym miesiącu")).toHaveCount(0);
  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  await expect(page.getByText("Budżet zapisany")).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wmt_budget") ?? "null"));
  expect(saved.percentages).toEqual({ NEEDS: 40, FUTURE: 25, GOALS: 15, FUN: 20 });
});

test("kredyty i pożyczki (na Wydatkach): raty, liczba rat i koszt w czasie pracy; plan trafia do localStorage", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Dodaj kredyt lub pożyczkę" }).click();

  const loan = page.getByTestId("loan-0");
  await loan.getByLabel("Nazwa").fill("Kredyt gotówkowy");
  await loan.getByLabel("Wysokość raty").fill("800");
  await loan.getByLabel("Rat do spłacenia").fill("36");
  await loan.getByLabel("Suma kredytu").fill("40000");

  // 800 x 36 = 28 800 zł do spłaty; przy 40,38 zł/h (dochód 7 000 zł) to 713 h pracy
  await expect(page.getByTestId("loan-summary-0")).toContainText("28 800,00");
  await expect(page.getByTestId("loan-summary-0")).toContainText("713 h");
  await expect(page.getByTestId("loans-total")).toContainText("800,00");

  // niepoprawna liczba rat -> błąd przy polu
  await loan.getByLabel("Rat do spłacenia").fill("0");
  await page.getByRole("button", { name: "Zapisz kredyty" }).click();
  await expect(page.getByText("Liczba rat: całkowita, od 1 do 600")).toBeVisible();
  await loan.getByLabel("Rat do spłacenia").fill("36");
  await expect(page.getByTestId("loans-status")).toHaveText("Masz niezapisane zmiany w kredytach.");
  await page.getByRole("button", { name: "Zapisz kredyty" }).click();
  await expect(page.getByText("Kredyty zapisane", { exact: true })).toBeVisible();
  await expect(page.getByTestId("loans-status")).toHaveText("Kredyty zapisane.");

  // zapisane raty od razu obciążają Potrzeby na Wydatkach (800 zł z 3 500 zł) i w Budżecie (dostępne 2 700 zł)
  await expect(page.getByTestId("usage-NEEDS")).toContainText(/800,00\szł \/ 3\s500,00\szł/);

  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wmt_budget") ?? "null"));
  expect(saved.loans).toEqual([
    { name: "Kredyt gotówkowy", installment_amount: 800, installments_left: 36, loan_amount: 40000, start_date: null, end_date: null, payment_day: null },
  ]);
  expect(saved.percentages).toEqual({ NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 }); // zapis kredytów nie rusza podziału dochodu

  // strona Budżet nie ma już formularza kredytów: pokazuje tylko, ile rat obciąża Potrzeby, i odsyła do Wydatków
  await page.goto("/budget");
  await expect(page.getByTestId("loan-0")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dodaj kredyt lub pożyczkę" })).toHaveCount(0);
  await expect(page.getByTestId("budget-NEEDS")).toContainText("2 700,00");
  await expect(page.getByTestId("loans-total")).toContainText(/800,00\szł/);
  // zapis budżetu zostawia kredyty bez zmian
  await page.getByTestId("budget-NEEDS").getByLabel("Udział w dochodzie (%)").fill("40");
  await page.getByTestId("budget-FUN").getByLabel("Udział w dochodzie (%)").fill("20");
  await page.getByRole("button", { name: "Zapisz budżet" }).click();
  await expect(page.getByText("Budżet zapisany")).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wmt_budget") ?? "null"));
  expect(after.percentages.NEEDS).toBe(40);
  expect(after.loans).toHaveLength(1);
  expect(after.loans[0]).toMatchObject({ name: "Kredyt gotówkowy", installment_amount: 800, installments_left: 36 });
});

test("karta budżetu pokazuje raty kredytów i ostrzeżenie, gdy zjadają budżet Potrzeb", async ({ page }) => {
  await withLocalProfile(page);
  await page.route("**/api/v1/calculate", (r) =>
    json(r, {
      ...RESULT,
      budget: {
        ...BUDGET_EXCEEDED,
        category: "NEEDS",
        priority: "P0",
        fits_budget: true,
        obligations: { monthly_installments: 4200, loans_count: 2, income_percent: 60, last_installment_in_months: 36, included_in_category: true },
        warnings: [{ code: "LOANS_EXCEED_NEEDS_BUDGET", level: "critical", params: { monthly_loans: 4200, needs_budget: 3500, overrun: 700 } }],
      },
    }),
  );
  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Lodówka");
  await page.getByLabel("Cena").fill("1000");
  await page.getByRole("radio", { name: "Potrzeby" }).click();
  await page.getByRole("button", { name: "Oblicz" }).click();
  await expect(page.getByTestId("obligations")).toContainText("4 200,00");
  await expect(page.getByTestId("obligations")).toContainText("ostatnia rata za 36 mies.");
  await expect(page.getByTestId("warning-LOANS_EXCEED_NEEDS_BUDGET")).toContainText("Raty kredytów zjadają cały budżet Potrzeb");
  await expect(page.getByTestId("warning-LOANS_EXCEED_NEEDS_BUDGET")).toHaveAttribute("data-level", "critical");
});

test("historia: znacznik poza budżetem", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) => json(r, { ...BUDGET_PLAN, is_custom: false, amounts: null, available: null, monthly_income: null, total_spent: 0 }));
  await page.route("**/api/v1/calculations", (r) =>
    json(r, { items: [{ ...SAVED, result: { ...RESULT, budget: BUDGET_EXCEEDED } }] }),
  );
  await signedIn(page);
  await page.goto("/history");
  await expect(page.getByTestId("history-over-budget")).toHaveText("poza budżetem");
  await expect(page.getByTestId("history-category")).toHaveText("Przyjemności");
});