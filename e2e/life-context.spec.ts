import { expect, test } from "@playwright/test";
import { json, PROFILE, signedIn } from "./mocks";

const EMPTY = {
  housing: null,
  household_size: null,
  children: null,
  car: null,
  car_age_years: null,
  commute: null,
  work_mode: null,
  employment: null,
  phone_age_years: null,
  computer_age_years: null,
  has_emergency_fund: null,
  emergency_fund_months: null,
  saves_regularly: null,
  invests: null,
  has_pets: null,
  pets_description: null,
  regular_health_costs: null,
  does_sport: null,
  pays_for_education: null,
  custom: [],
  notes: null,
};

test("profil: wywiad o sytuacji życiowej w grupach, zapis i opis dla Jev", async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, { percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 }, spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, loans: [], is_custom: false, amounts: null, available: null, monthly_income: null, total_spent: 0 }),
  );
  await page.route("**/api/v1/profile/context", (r) => {
    if (r.request().method() !== "PUT") return json(r, { context: EMPTY, summary: [], filled: false });
    saved = r.request().postDataJSON();
    return json(r, {
      context: saved,
      summary: ["Mieszka z rodzicami: nie płaci czynszu najmu ani raty za mieszkanie.", "Ma własny samochód (wiek auta: 8 lat).", "Pracuje zdalnie, z domu."],
      filled: true,
    });
  });
  await signedIn(page);
  await page.goto("/profile");

  const card = page.getByTestId("life-context-card");
  await expect(card).toContainText("przekazujemy Jev"); // wiadomo, dokąd trafiają odpowiedzi
  for (const group of ["Mieszkanie", "Transport", "Praca", "Sprzęt", "Oszczędności", "Zwierzęta", "Zdrowie i rozwój", "Własne kategorie", "Coś jeszcze"]) {
    await expect(card.getByRole("group", { name: group })).toBeVisible();
  }
  await expect(page.getByTestId("life-summary")).toHaveCount(0);

  await card.getByLabel("Gdzie mieszkasz?").selectOption({ label: "Mieszkam z rodzicami" });
  await card.getByLabel("Osób w gospodarstwie").fill("4");
  // wiek samochodu pojawia się dopiero, gdy samochód jest
  await expect(card.getByLabel("Wiek samochodu (lata)")).toHaveCount(0);
  await card.getByLabel("Samochód", { exact: true }).selectOption({ label: "Mam własny" });
  await card.getByLabel("Wiek samochodu (lata)").fill("8");
  await card.getByLabel("Jak pracujesz?").selectOption({ label: "Zdalnie" });
  await card.getByLabel("Wiek telefonu (lata)").fill("3");
  // pytania zależne pojawiają się po odpowiedzi "Tak"
  await expect(card.getByLabel("Na ile miesięcy wydatków")).toHaveCount(0);
  await card.getByLabel("Poduszka finansowa").selectOption({ label: "Tak" });
  await card.getByLabel("Na ile miesięcy wydatków").fill("3");
  await card.getByLabel("Inwestujesz?").selectOption({ label: "Nie" });
  await card.getByLabel("Masz zwierzęta domowe?").selectOption({ label: "Tak" });
  await card.getByLabel("Jakie? (opcjonalnie)").fill("pies i dwa koty");
  await card.getByLabel("Regularny sport lub siłownia").selectOption({ label: "Tak" });

  // własne kategorie: dwie dodane, jedna usunięta, a wiersz bez opisu nie jest wysyłany
  const custom = page.getByTestId("life-custom");
  await custom.getByRole("button", { name: "Dodaj własną kategorię" }).click();
  await custom.getByLabel("Nazwa 1").fill("Do usunięcia");
  await custom.getByRole("button", { name: "Dodaj własną kategorię" }).click();
  await custom.getByLabel("Nazwa 2").fill("Hobby");
  await custom.getByLabel("Opis 2").fill("fotografia, co kilka miesięcy kupuję sprzęt");
  await custom.getByRole("button", { name: "Usuń własną kategorię 1" }).click();
  await expect(custom.getByLabel("Nazwa 1")).toHaveValue("Hobby");
  await custom.getByRole("button", { name: "Dodaj własną kategorię" }).click();
  await custom.getByLabel("Nazwa 2").fill("Bez opisu");
  await card.getByLabel("Coś jeszcze, co warto wiedzieć? (opcjonalnie)").fill("odkładam na własne mieszkanie");
  await card.getByRole("button", { name: "Zapisz wywiad" }).click();

  await expect(page.getByText("Wywiad zapisany")).toBeVisible();
  expect(saved).toEqual({
    ...EMPTY,
    housing: "WITH_PARENTS",
    household_size: 4,
    car: "OWN",
    car_age_years: 8,
    work_mode: "REMOTE",
    phone_age_years: 3,
    has_emergency_fund: true,
    emergency_fund_months: 3,
    invests: false,
    has_pets: true,
    pets_description: "pies i dwa koty",
    does_sport: true,
    custom: [{ name: "Hobby", description: "fotografia, co kilka miesięcy kupuję sprzęt" }],
    notes: "odkładam na własne mieszkanie",
  });
  const summary = page.getByTestId("life-summary");
  await expect(summary).toContainText("Tak opisujemy Twoją sytuację Jev");
  await expect(summary.locator("li")).toHaveCount(3);
  await expect(summary).toContainText("Mieszka z rodzicami");
});
