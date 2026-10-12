import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, RESULT, SAVED, signedIn, withLocalLedger, withLocalProfile } from "./mocks";

/** Zalogowany użytkownik: token w localStorage + /auth/me i pusty /budget. */
async function asLoggedIn(page: Page) {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
      ledger: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
      spent_total: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
      loans: [],
      monthly_loans: 0,
      loans_income_percent: null,
      last_installment_in_months: 0,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 500 },
      monthly_income: 7000,
      total_spent: 0,
      is_custom: false,
    }),
  );
  await signedIn(page);
}

test("rejestr wydatków (bez konta): dopisanie, zużycie budżetu, usunięcie i plan w żądaniu", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");

  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Kwota").fill("200");
  await page.getByLabel("Notatka (opcjonalnie)").fill("kino");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();

  await expect(page.getByTestId("expense-list-FUN")).toContainText("kino"); // kategoria rozwija się po dopisaniu
  // budżet FUN przy dochodzie 7 000 zł to 700 zł: 200 / 700 = 29%
  await expect(page.getByTestId("usage-FUN")).toContainText("29%");

  // kalkulator wysyła plan z wydanymi 200 zł (z rejestru) w kategorii FUN
  let sent: { budget?: { spent: Record<string, number> } } | undefined;
  await page.route("**/api/v1/calculate", (r) => {
    sent = r.request().postDataJSON();
    return json(r, RESULT);
  });
  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Gra");
  await page.getByLabel("Cena").fill("100");
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByRole("button", { name: "Oblicz" }).click();
  await expect(page.getByTestId("hours")).toBeVisible();
  expect(sent?.budget?.spent.FUN).toBe(200);

  await page.goto("/expenses");
  await page.getByTestId("usage-FUN").getByRole("button", { expanded: false }).click(); // po wejściu kategorie są zwinięte
  await page.getByRole("button", { name: /Usuń wydatek kino/ }).click();
  await expect(page.getByText("Nic jeszcze nie dopisano.")).toBeVisible();
});

test("dzienny limit i prognoza: ile na dzień, pasek dzisiejszych wydatków i ostrzeżenie o tempie", async ({ page }) => {
  // 10 października 2026: 22 dni do końca miesiąca (z dzisiejszym), dochód 7 000 zł, Przyjemności 700 zł
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  await page.goto("/expenses");

  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await expect(page.getByTestId("form-daily-limit")).toContainText(/Zostało\s700,00\szł na 22 dni/);

  await page.getByLabel("Kwota").fill("400");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByTestId("expense-list-FUN")).toBeVisible();

  // zostało 300 zł na 22 dni = 13,64 zł dziennie; tempo 40 zł dziennie wyczerpie budżet za 7 dni
  const daily = page.getByTestId("daily-FUN");
  await expect(daily).toContainText(/Zostało\s300,00\szł na 22 dni/);
  await expect(page.getByTestId("daily-FUN-daily")).toContainText(/13,64\szł/);
  await expect(page.getByTestId("daily-FUN-warning")).toContainText("tej kwoty wystarczy na 7 dni");

  // pasek w formularzu: dziś wydano 400 zł z dziennego limitu 13,64 zł
  await expect(page.getByTestId("form-daily-limit")).toContainText(/Dziś w tej kategorii: 400,00\szł z 13,64\szł/);

  // ta sama informacja na stronie Budżet
  await page.goto("/budget");
  await expect(page.getByTestId("daily-FUN")).toContainText(/Zostało\s300,00\szł na 22 dni/);
});

test("dzienny limit: bez prognozy w pierwszych dniach miesiąca i komunikat o wyczerpanym budżecie", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-02T10:00:00")); // 2. dnia tempo jest zbyt zaszumione
  await withLocalProfile(page);
  await page.goto("/expenses");
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Kwota").fill("500");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByTestId("daily-FUN")).toContainText(/Zostało\s200,00\szł na 30 dni/);
  await expect(page.getByTestId("daily-FUN-warning")).toHaveCount(0);

  await page.getByLabel("Kwota").fill("300");
  await page.getByRole("button", { name: "Dopisz wydatek" }).click();
  await expect(page.getByTestId("daily-FUN")).toContainText("Budżet kategorii wyczerpany");
  await expect(page.getByTestId("daily-FUN")).toHaveAttribute("data-status", "OVER");
});

test("stałe wydatki (bez konta): dopisują się do rejestru w dniu płatności i zmniejszają budżet", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await withLocalProfile(page);
  // szablon od sierpnia: wpisy za sierpień, wrzesień i październik (1. dnia miesiąca) powstają przy wejściu do aplikacji
  await page.addInitScript(() => {
    if (window.localStorage.getItem("wmt_recurring")) return; // nie nadpisuj stanu po odświeżeniu strony
    window.localStorage.setItem(
      "wmt_recurring",
      JSON.stringify([{ id: "r1", name: "Czynsz", category: "NEEDS", amount: 2000, day_of_month: 1, active: true, start_date: "2026-08-01", generated_through: null }]),
    );
  });
  await page.goto("/expenses");

  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();
  const list = page.getByTestId("expense-list-NEEDS");
  await expect(list).toContainText("Czynsz");
  await expect(list.getByTestId("expense-source")).toHaveText("stały");
  await expect(list.locator("li")).toHaveCount(1); // tylko październik jest w bieżącym miesiącu
  // Potrzeby: 3 500 zł budżetu, 2 000 zł czynszu = 57%
  await expect(page.getByTestId("usage-NEEDS")).toContainText("57%");

  // odświeżenie nie dopisuje duplikatów
  await page.reload();
  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("expense-list-NEEDS").locator("li")).toHaveCount(1);

  // nowy stały wydatek: pojawia się na liście szablonów z sumą miesięczną
  const card = page.getByTestId("recurring-card");
  await expect(card.getByTestId("recurring-total")).toContainText("2 000,00");
  await card.getByLabel("Nazwa").fill("Siłownia");
  await card.getByLabel("Opłata miesięczna").fill("150");
  await card.getByLabel("Dzień miesiąca").fill("31");
  await card.getByRole("button", { name: "Dodaj stały wydatek" }).click();
  await expect(card.getByTestId("recurring-Siłownia")).toContainText("ostatniego dnia miesiąca");
  await expect(card.getByTestId("recurring-total")).toContainText("2 150,00");

  // wyłączenie i usunięcie
  await card.getByRole("button", { name: "Wyłącz stały wydatek Siłownia" }).click();
  await expect(card.getByTestId("recurring-total")).toContainText("2 000,00");
  await card.getByRole("button", { name: "Usuń stały wydatek Siłownia" }).click();
  await expect(card.getByTestId("recurring-Siłownia")).toHaveCount(0);
});

test("raty: oznaczenie jako zapłacona zapisuje wpis i nie liczy raty drugi raz", async ({ page }) => {
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
  // Potrzeby: 3 500 zł budżetu, rata 800 zł = 23%
  await expect(page.getByTestId("usage-NEEDS")).toContainText("23%");

  await page.getByRole("button", { name: "Oznacz ratę Kredyt auto jako zapłaconą" }).click();
  await expect(page.getByTestId("paid-0")).toContainText("Opłacona");
  await expect(page.getByRole("button", { name: /jako zapłaconą/ })).toHaveCount(0);

  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();
  const list = page.getByTestId("expense-list-NEEDS");
  await expect(list).toContainText("Rata: Kredyt auto");
  await expect(list.getByTestId("expense-source")).toHaveText("rata");
  // rata jest już zobowiązaniem w Potrzebach, więc wpis nie podnosi wykorzystania budżetu
  await expect(page.getByTestId("usage-NEEDS")).toContainText("23%");
});

test("stałe wydatki i raty (konto): wywołania API i oznaczenie raty identyfikatorem z serwera", async ({ page }) => {
  await asLoggedIn(page);
  let templates = [{ id: "t1", name: "Czynsz", category: "NEEDS", amount: 2000, day_of_month: 5, active: true, start_date: "2026-01-01" }];
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/recurring-expenses**", async (r) => {
    const req = r.request();
    if (req.method() === "POST") {
      const b = req.postDataJSON();
      bodies.push(b);
      templates = [...templates, { id: "t2", ...b }];
      return json(r, templates[1], 201);
    }
    if (req.method() === "DELETE") {
      templates = templates.filter((t) => !req.url().endsWith(t.id));
      return json(r, { deleted: true });
    }
    return json(r, { items: templates, monthly_total: templates.reduce((s, t) => s + t.amount, 0) });
  });
  await page.route("**/api/v1/expenses**", (r) =>
    json(r, r.request().url().includes("summary") ? { months: [] } : { month: "2026-10", items: [], totals: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, total: 0, loan_payments: 0 }),
  );
  let paid: unknown;
  await page.route("**/api/v1/budget/loans/l1/pay", (r) => {
    paid = r.request().postDataJSON();
    return json(r, { id: "e1", category: "NEEDS", amount: 800, note: "Rata: Kredyt auto", spent_on: "2026-10-12", source_type: "LOAN", source_id: "l1" }, 201);
  });
  await page.route("**/api/v1/budget", (r) =>
    json(r, {
      percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
      spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
      loans: [{ id: "l1", name: "Kredyt auto", installment_amount: 800, installments_left: 24, payment_day: 12 }],
      monthly_loans: 800,
      amounts: { NEEDS: 3500, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      available: { NEEDS: 2700, FUTURE: 1750, GOALS: 1050, FUN: 700 },
      monthly_income: 7000,
      total_spent: 800,
      is_custom: true,
    }),
  );
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00"));
  await page.goto("/expenses");

  const card = page.getByTestId("recurring-card");
  await expect(card.getByTestId("recurring-Czynsz")).toContainText("co miesiąc 5.");
  await card.getByLabel("Nazwa").fill("Internet");
  await card.getByLabel("Opłata miesięczna").fill("60");
  await card.getByLabel("Dzień miesiąca").fill("15");
  await card.getByRole("button", { name: "Dodaj stały wydatek" }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ name: "Internet", amount: 60, day_of_month: 15, category: "NEEDS", active: true });

  await page.getByRole("button", { name: "Oznacz ratę Kredyt auto jako zapłaconą" }).click();
  await expect.poll(() => paid).toEqual({ paid_on: "2026-10-12" });
});

test("lista życzeń: usuwanie rozstrzygniętych pozycji z potwierdzeniem", async ({ page }) => {
  await asLoggedIn(page);
  const work = { ...RESULT.work, hours: 61.9 };
  const base = { category: null, cooldown_days: 30, created_at: "2026-09-01T10:00:00Z", ready_at: "2026-10-01T10:00:00Z", days_left: 0, ready: false, work };
  let items = [
    { ...base, id: "w1", name: "Monitor (pomyłka)", price: 3000, status: "DROPPED", decided_at: "2026-10-02T10:00:00Z" },
    { ...base, id: "w2", name: "Słuchawki", price: 450, status: "BOUGHT", decided_at: "2026-10-03T10:00:00Z" },
  ];
  await page.route("**/api/v1/wishlist", (r) =>
    json(r, { items, stats: { dropped_count: items.filter((i) => i.status === "DROPPED").length, dropped_total: 0, dropped_hours: 0, waiting_count: 0, waiting_total: 0, ready_count: 0 }, currency: "PLN" }),
  );
  const deleted: string[] = [];
  await page.route("**/api/v1/wishlist/*", (r) => {
    if (r.request().method() !== "DELETE") return r.fallback();
    const id = new URL(r.request().url()).pathname.split("/").pop()!;
    deleted.push(id);
    items = items.filter((i) => i.id !== id);
    return json(r, { deleted: true });
  });

  await page.goto("/wishlist");
  const resolved = page.getByRole("region", { name: "Rozstrzygnięte" });
  await expect(resolved).toContainText("Monitor (pomyłka)");
  await expect(resolved).toContainText("Słuchawki");

  // najpierw potwierdzenie z informacją o skutku; anulowanie nic nie usuwa
  await page.getByRole("button", { name: "Usuń rozstrzygniętą pozycję Monitor (pomyłka)" }).click();
  const confirm = page.getByRole("group", { name: /Potwierdź usunięcie: Monitor/ });
  await expect(confirm).toContainText("Przestanie się liczyć do zaoszczędzonej kwoty");
  await confirm.getByRole("button", { name: "Anuluj" }).click();
  await expect(confirm).toHaveCount(0);
  expect(deleted).toEqual([]);

  await page.getByRole("button", { name: "Usuń rozstrzygniętą pozycję Monitor (pomyłka)" }).click();
  await page.getByRole("group", { name: /Potwierdź usunięcie: Monitor/ }).getByRole("button", { name: "Usuń", exact: true }).click();
  await expect.poll(() => deleted).toEqual(["w1"]);
  await expect(resolved).not.toContainText("Monitor (pomyłka)");
  await expect(resolved).toContainText("Słuchawki"); // druga pozycja zostaje
  await expect(page.getByText("Usunięto: Monitor (pomyłka)")).toBeVisible();

  // kupioną pozycję usuwa się bez ostrzeżenia o zaoszczędzonej kwocie
  await page.getByRole("button", { name: "Usuń rozstrzygniętą pozycję Słuchawki" }).click();
  await expect(page.getByRole("group", { name: /Potwierdź usunięcie: Słuchawki/ })).not.toContainText("zaoszczędzonej");
});

test("raty w drzewie wydatków: nieopłacone pod Potrzebami z terminem, opłacenie jednej nie rusza drugiej", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await withLocalProfile(page);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("wmt_budget")) return; // nie nadpisuj stanu po odświeżeniu strony
    window.localStorage.setItem(
      "wmt_budget",
      JSON.stringify({
        percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
        spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
        // dwie pożyczki o tej samej nazwie i tym samym terminie, różne raty
        loans: [
          { name: "Pożyczka gotówkowa", installment_amount: 540.18, installments_left: 12, payment_day: 11 },
          { name: "Pożyczka gotówkowa", installment_amount: 926.73, installments_left: 24, payment_day: 11 },
        ],
      }),
    );
  });
  await page.goto("/expenses");

  const needs = page.getByTestId("usage-NEEDS");
  await expect(needs).toContainText("2 raty do zapłaty");
  await needs.getByRole("button", { expanded: false }).click();

  const rows = page.getByTestId("loan-rows-NEEDS");
  await expect(rows.locator("li")).toHaveCount(2);
  await expect(rows).toContainText("rata do zapłaty");
  await expect(rows).toContainText(/540,18\szł/);
  await expect(rows).toContainText(/926,73\szł/);
  await expect(rows).toContainText("11 października 2026");
  await expect(rows).toContainText("za 4 dni");

  // opłacenie jednej raty (kwota 540,18) nie oznacza drugiej, o tej samej nazwie
  await rows.locator("li", { hasText: "540,18" }).getByRole("button", { name: "Zapłacona: rata Pożyczka gotówkowa" }).click();
  await expect(rows.locator("li")).toHaveCount(1);
  await expect(rows).toContainText(/926,73\szł/);
  await expect(needs).toContainText("1 rata do zapłaty");
  const list = page.getByTestId("expense-list-NEEDS");
  await expect(list).toContainText("Rata: Pożyczka gotówkowa");
  await expect(list.getByTestId("expense-source")).toHaveText("rata");

  // opłacona rata nie wraca do listy "do zapłaty" po odświeżeniu
  await page.reload();
  await page.getByTestId("usage-NEEDS").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("loan-rows-NEEDS").locator("li")).toHaveCount(1);
});

test("lista życzeń: ostygnięcie, odpuszczenie i statystyka oszczędności", async ({ page }) => {
  await asLoggedIn(page);
  const work = { ...RESULT.work, hours: 61.9 };
  let items = [
    { id: "w1", name: "PlayStation", price: 2500, category: "FUN", cooldown_days: 30, status: "WAITING", created_at: "2026-09-01T10:00:00Z", decided_at: null, ready_at: "2026-10-01T10:00:00Z", days_left: 0, ready: true, work },
    { id: "w2", name: "Rower", price: 3000, category: null, cooldown_days: 30, status: "WAITING", created_at: "2026-10-01T10:00:00Z", decided_at: null, ready_at: "2026-10-31T10:00:00Z", days_left: 25, ready: false, work },
  ];
  const stats = (dropped: number) => ({ dropped_count: dropped, dropped_total: dropped * 2500, dropped_hours: dropped * 61.9, waiting_count: 2 - dropped, waiting_total: 0, ready_count: 0 });
  await page.route("**/api/v1/wishlist", (r) => json(r, { items, stats: stats(items.filter((i) => i.status === "DROPPED").length), currency: "PLN" }));
  await page.route("**/api/v1/wishlist/w1/decision", (r) => {
    items = items.map((i) => (i.id === "w1" ? { ...i, status: "DROPPED", ready: false } : i));
    return json(r, items[0]);
  });

  await page.goto("/wishlist");
  const ready = page.getByTestId("wish-w1");
  await expect(ready).toHaveAttribute("data-ready", "true");
  await expect(ready.getByRole("button", { name: "Kupuję" })).toBeVisible();
  const waiting = page.getByTestId("wish-w2");
  await expect(waiting).toContainText("Jeszcze 25 dni ostygnięcia");
  await expect(waiting.getByRole("button", { name: "Kupuję" })).toHaveCount(0); // kupić można dopiero po ostygnięciu

  await ready.getByRole("button", { name: "Odpuszczam" }).click();
  await expect(page.getByTestId("wish-savings")).toContainText("2 500,00");
  await expect(page.getByTestId("wish-savings")).toContainText("61,9 h");
});

test("cele oszczędnościowe: postęp, data osiągnięcia i wpłata", async ({ page }) => {
  await asLoggedIn(page);
  let goal = {
    id: "g1", name: "Wakacje", target_amount: 5000, saved_amount: 500, monthly_contribution: 1000, target_date: "2027-03-01",
    remaining: 4500, percent: 10, completed: false, months_to_goal: 4.5, months_to_goal_full: 5, eta: "2027-02-15",
    required_monthly: 907, on_track: true, work_hours_remaining: 111.4,
  };
  await page.route("**/api/v1/goals", (r) => json(r, { items: [goal], currency: "PLN" }));
  await page.route("**/api/v1/goals/g1/deposit", (r) => {
    goal = { ...goal, saved_amount: 1500, remaining: 3500, percent: 30, months_to_goal: 3.5, eta: "2027-01-15" };
    return json(r, goal);
  });

  await page.goto("/goals");
  const card = page.getByTestId("goal-g1");
  await expect(card.getByTestId("goal-percent")).toHaveText("10%");
  await expect(card.getByTestId("goal-eta")).toContainText("luty 2027");
  await expect(card.getByTestId("goal-track")).toHaveText("zdążysz w terminie");

  await card.getByLabel("Kwota wpłaty: Wakacje").fill("1000");
  await card.getByRole("button", { name: "Wpłać" }).click();
  await expect(card.getByTestId("goal-percent")).toHaveText("30%");
});

test("strona Profil: przed zalogowaniem tylko logowanie, profil finansowy dopiero na koncie", async ({ page }) => {
  await withLocalProfile(page); // nawet z profilem zapisanym w przeglądarce formularz jest schowany
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Zaloguj", exact: true })).toBeVisible();
  await expect(page.getByTestId("profile-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zapisz profil" })).toHaveCount(0);
  await expect(page.getByLabel("Miesięczny dochód netto")).toHaveCount(0);
});

test("strona Profil: po zalogowaniu widać profil finansowy z danymi konta", async ({ page }) => {
  await asLoggedIn(page);
  await page.goto("/profile");
  await expect(page.getByText("Zalogowano jako")).toBeVisible();
  await expect(page.getByTestId("profile-card").getByLabel("Miesięczny dochód netto")).toHaveValue("7000");
  await expect(page.getByRole("button", { name: "Zapisz profil" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zaloguj", exact: true })).toHaveCount(0);
});

test("realna stawka godzinowa: porównanie z nominalną i wybór trybu", async ({ page }) => {
  // bez konta profil finansowy podaje się w pierwszym kroku kalkulatora (strona Profil pokazuje go dopiero po zalogowaniu)
  await page.goto("/calculator");
  await page.getByLabel("Miesięczny dochód netto").fill("10000");
  await page.getByLabel(/Dojazd dziennie/).fill("90");
  await page.getByLabel("Koszty pracy miesięcznie").fill("600");
  await expect(page.getByTestId("nominal-rate")).toContainText("57,69");
  await expect(page.getByTestId("real-rate")).toContainText("45,67");

  await page.getByRole("radio", { name: "Licz realną" }).click();
  await page.getByRole("button", { name: "Dalej: policz zakup" }).click();
  await expect(page.getByText("Profil zapisany")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wmt_profile") ?? "null"));
  expect(saved).toMatchObject({ rate_mode: "REAL", commute_minutes_per_day: 90, work_costs_monthly: 600 });
});

test("koszt na użycie, odpowiedniki i tryb co jeśli", async ({ page }) => {
  await withLocalProfile(page);
  const bodies: { profile: { monthly_income: number } }[] = [];
  await page.route("**/api/v1/calculate", (r) => {
    bodies.push(r.request().postDataJSON());
    const hours = bodies.length === 1 ? 131.2 : 100.9;
    return json(r, {
      ...RESULT,
      per_use: { uses: 300, cost: 10, work_minutes: 14.9 },
      work: { ...RESULT.work, hours, income_percent: bodies.length === 1 ? 75.7 : 58.2 },
    });
  });

  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Rower");
  await page.getByLabel("Cena").fill("3000");
  await page.getByLabel(/Ile razy tego użyjesz/).fill("300");
  await page.getByRole("button", { name: "Oblicz" }).click();

  await expect(page.getByTestId("per-use")).toContainText("10,00");
  await expect(page.getByTestId("per-use")).toContainText("14,9 min");
  await expect(page.getByTestId("equivalents")).toContainText("6,3%"); // 75,7% / 12 rocznego dochodu

  await page.getByLabel("Zmiana dochodu").fill("30");
  await expect(page.getByTestId("what-if-result")).toContainText("100,9 h");
  await expect(page.getByTestId("what-if-result")).toContainText("58,2%");
  expect(bodies[1].profile.monthly_income).toBeCloseTo(9100, 0); // 7 000 zł + 30%
});

test("audyt subskrypcji sumuje koszty roczne i godziny pracy", async ({ page }) => {
  await asLoggedIn(page);
  const sub = (id: string, name: string, yearly: number, hours: number) => ({
    ...SAVED,
    id,
    name,
    type: "RECURRING",
    result: { ...RESULT, name, type: "RECURRING", horizons: [{ label: "1 year", years: 1, cost: yearly, work: { ...RESULT.work, hours, working_days: hours / 8 } }] },
  });
  await page.route("**/api/v1/calculations", (r) => json(r, { items: [sub("s1", "Netflix", 588, 14.6), sub("s2", "Spotify", 240, 5.9), SAVED] }));
  await page.goto("/subscriptions");
  await expect(page.getByTestId("subs-total")).toContainText("828,00");
  await expect(page.getByTestId("subs-total")).toContainText("21 h");
  const rows = page.getByTestId("subs-list").locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Netflix"); // od najdroższego
});

test("menu Więcej udostępnia pozostałe sekcje", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("navigation", { name: "Nawigacja mobilna" }).getByRole("button", { name: "Więcej" }).click();
    await expect(page.getByRole("link", { name: "Cele" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Subskrypcje" })).toBeVisible();
  } else {
    await page.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("button", { name: "Więcej" }).click();
    await expect(page.getByRole("menuitem", { name: "Cele" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Subskrypcje" })).toBeVisible();
  }
});

test("maksymalna miesięczna wpłata z kategorii: podpowiedź, szybkie wypełnienie i ostrzeżenie o przekroczeniu", async ({ page }) => {
  await withLocalProfile(page); // dochód 7 000 zł: budżet Przyjemności to 700 zł
  await withLocalLedger(page, [{ category: "FUN", amount: 200 }]); // zostaje 500 zł
  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Konsola");
  await page.getByLabel("Cena").fill("2500");
  await page.getByRole("radio", { name: "Przyjemności" }).click();

  const hint = page.getByTestId("category-availability");
  await expect(hint).toContainText("500,00");
  await expect(hint).toContainText("Przyjemności");
  await expect(page.getByText("Zostaw puste, a przyjmiemy maksimum: 500,00")).toBeVisible();

  await hint.getByRole("button", { name: "Użyj maksimum" }).click();
  await expect(page.getByLabel("Miesięczna wpłata")).toHaveValue("500");

  await page.getByLabel("Miesięczna wpłata").fill("800");
  await expect(page.getByText("Więcej niż dostępne w kategorii (500,00")).toBeVisible();
});

test("karta budżetu: maksymalna wpłata z kategorii i ostrzeżenie o zbyt dużej wpłacie", async ({ page }) => {
  await withLocalProfile(page);
  await page.route("**/api/v1/calculate", (r) =>
    json(r, {
      ...RESULT,
      budget: {
        category: "FUN", priority: "P4", percentage: 10, category_budget: 1000, spent: 200, available: 800, usage_percent: 20,
        is_custom: true, fits_budget: false, obligations: null, monthly: null,
        upfront: {
          cost: 3200, projected_spent: 3400, projected_usage_percent: 340, purchase_share_percent: 320, coverage_ratio: 400,
          months_to_goal: 3.2, months_to_goal_full: 4, monthly_contribution: 1000, max_monthly_contribution: 800,
          contribution_source: "USER", already_saved: 0, income_percent: 32,
        },
        warnings: [{ code: "CONTRIBUTION_EXCEEDS_AVAILABLE", level: "warning", params: { category: "FUN", planned: 1000, max_monthly: 800, overrun: 200 } }],
      },
    }),
  );
  await page.goto("/calculator");
  await page.getByLabel("Co chcesz kupić?").fill("Konsola");
  await page.getByLabel("Cena").fill("3200");
  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await page.getByLabel("Miesięczna wpłata").fill("1000");
  await page.getByRole("button", { name: "Oblicz" }).click();

  await expect(page.getByTestId("max-contribution")).toContainText("800,00");
  await expect(page.getByTestId("max-contribution")).toContainText("Planujesz więcej: 1 000,00");
  await expect(page.getByTestId("warning-CONTRIBUTION_EXCEEDS_AVAILABLE")).toContainText("brakuje 200,00");
});

test("cel z kategorii: maksymalna wpłata wynika z wolnych środków kategorii", async ({ page }) => {
  await asLoggedIn(page);
  const goal = {
    id: "g9", name: "Konsola", category: "FUN", target_amount: 3200, saved_amount: 0, monthly_contribution: null,
    effective_contribution: 800, max_monthly_contribution: 800, contribution_source: "CATEGORY_AVAILABLE", contribution_exceeds: false,
    target_date: null, remaining: 3200, percent: 0, completed: false, months_to_goal: 4, months_to_goal_full: 4, eta: "2027-02-06",
    required_monthly: null, on_track: null, work_hours_remaining: 79,
  };
  await page.route("**/api/v1/goals", (r) => json(r, { items: [goal, { ...goal, id: "g10", name: "Rower", monthly_contribution: 900, contribution_exceeds: true, effective_contribution: 900, contribution_source: "USER" }], currency: "PLN" }));

  await page.goto("/goals");
  const card = page.getByTestId("goal-g9");
  await expect(card.getByTestId("goal-max")).toContainText("800,00");
  await expect(card.getByTestId("goal-eta")).toContainText("luty 2027");
  await expect(card).toContainText("Przyjemności");
  await expect(page.getByTestId("goal-g10").getByTestId("goal-exceeds")).toBeVisible();

  await page.getByRole("radio", { name: "Przyjemności" }).click();
  await expect(page.getByTestId("goal-category-availability")).toContainText("Przyjemności");
});
test("kredyt z okresem spłaty i dniem raty: liczba rat z daty końca, najbliższa rata i postęp", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Dodaj kredyt lub pożyczkę" }).click();

  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const start = iso(new Date(now.getFullYear(), now.getMonth() - 6, 1));
  const end = iso(new Date(now.getFullYear(), now.getMonth() + 11, 15));

  const loan = page.getByTestId("loan-0");
  await loan.getByLabel("Nazwa").fill("Kredyt samochodowy");
  await loan.getByLabel("Wysokość raty").fill("1000");
  await loan.getByLabel("Dzień raty w miesiącu").fill("15");
  await loan.getByLabel("Spłata od").fill(start);
  await loan.getByLabel("Spłata do").fill(end);

  // liczba rat wylicza się z daty końca (raty 15. dnia: 11 albo 12 w zależności od dzisiejszego dnia miesiąca)
  await expect(loan.getByLabel("Rat do spłacenia")).toHaveAttribute("placeholder", /wyliczone: (11|12)/);
  await expect(page.getByTestId("loan-next-0")).toContainText("Najbliższa rata: 15");
  await expect(page.getByTestId("loan-next-0")).toContainText("ostatnia: 15");
  await expect(loan.getByRole("progressbar", { name: "Postęp okresu spłaty" })).toBeVisible();
  await expect(page.getByTestId("loans-total")).toContainText("1 000,00");

  // dzień raty poza zakresem i koniec przed początkiem -> błędy przy polach
  await loan.getByLabel("Dzień raty w miesiącu").fill("40");
  await loan.getByLabel("Spłata do").fill(iso(new Date(now.getFullYear(), now.getMonth() - 8, 1)));
  await page.getByRole("button", { name: "Zapisz kredyty" }).click();
  await expect(page.getByText("Dzień miesiąca od 1 do 31")).toBeVisible();
  await expect(page.getByText("Koniec spłaty nie może być przed początkiem")).toBeVisible();

  await loan.getByLabel("Dzień raty w miesiącu").fill("15");
  await loan.getByLabel("Spłata do").fill(end);
  await page.getByRole("button", { name: "Zapisz kredyty" }).click();
  await expect(page.getByText("Kredyty zapisane", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("wmt_budget") ?? "null"));
  expect(saved.loans[0]).toMatchObject({ payment_day: 15, start_date: start, end_date: end, installments_left: null });
});

test("kredyt spłacony (data końca w przeszłości) nie obciąża budżetu; brak raty i daty końca to błąd", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Dodaj kredyt lub pożyczkę" }).click();
  const loan = page.getByTestId("loan-0");
  await loan.getByLabel("Nazwa").fill("Stara pożyczka");
  await loan.getByLabel("Wysokość raty").fill("500");

  await page.getByRole("button", { name: "Zapisz kredyty" }).click();
  await expect(page.getByText("Podaj liczbę rat albo datę końca spłaty")).toBeVisible();

  await loan.getByLabel("Spłata do").fill("2020-01-15");
  await expect(page.getByTestId("loan-summary-0")).toContainText("uznajemy za spłacony");
  await expect(page.getByTestId("loans-total")).toHaveCount(0); // 0 zł rat - nic do pokazania
});

test("wydatki: zbliżające się raty z datą i dniem", async ({ page }) => {
  await withLocalProfile(page);
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "wmt_budget",
      JSON.stringify({
        percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 },
        spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 },
        loans: [{ name: "Kredyt hipoteczny", installment_amount: 2100, installments_left: 120, payment_day: 10 }],
      }),
    ),
  );
  await page.goto("/expenses");
  const card = page.getByTestId("upcoming-installments");
  await expect(card).toContainText("Kredyt hipoteczny");
  await expect(card).toContainText("2 100,00");
  await expect(card).toContainText(/za \d+ (dzień|dni)|dziś/);
});