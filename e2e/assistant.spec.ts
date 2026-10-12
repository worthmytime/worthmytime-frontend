import { expect, test, type Page } from "@playwright/test";
import { json, PROFILE, signedIn, withLocalProfile } from "./mocks";

const CONTEXT = [
  "Miesięczny dochód netto: 7000.00 PLN.",
  "Przyjemności: budżet 700.00 PLN, wydane 650.00 PLN, zostało 50.00 PLN, dzienny limit do końca miesiąca 4.17 PLN.",
];

async function asLoggedIn(page: Page, configured = true) {
  await page.route("**/api/v1/auth/me", (r) => json(r, { id: "u1", email: "a@b.pl", profile: PROFILE }));
  await page.route("**/api/v1/budget", (r) =>
    json(r, { percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 }, spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, loans: [], is_custom: false, amounts: null, available: null, monthly_income: 7000, total_spent: 0 }),
  );
  await page.route("**/api/v1/assistant/context", (r) => json(r, { context: CONTEXT, configured }));
  await signedIn(page);
}

test("asystent AI: gotowe pytanie, odpowiedź i kolejne pytanie z całą rozmową", async ({ page }) => {
  await asLoggedIn(page);
  const sent: { messages: { role: string; content: string }[] }[] = [];
  await page.route("**/api/v1/assistant/chat", (r) => {
    sent.push(r.request().postDataJSON());
    return json(r, { reply: sent.length === 1 ? "Na przyjemności zostało Ci 50 zł.\nWydawaj najwyżej 4 zł dziennie." : "Tak, ale z kategorii Cele." });
  });
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Asystent AI" })).toBeVisible();

  // użytkownik widzi, jakie dane dostaje model i że trafiają na zewnątrz
  const context = page.getByTestId("assistant-context");
  await context.getByText("Co widzi asystent").click();
  await expect(context).toContainText("zewnętrznego modelu językowego");
  await expect(context.locator("li")).toHaveCount(2);
  await expect(context).toContainText("Przyjemności: budżet 700.00 PLN");

  // gotowe pytanie na start
  await page.getByTestId("assistant-starters").getByRole("button", { name: "Co zrobić, żeby pieniędzy starczyło do końca miesiąca?" }).click();
  const messages = page.getByTestId("assistant-messages");
  await expect(messages.locator('li[data-role="user"]')).toContainText("Co zrobić, żeby pieniędzy starczyło");
  await expect(messages.locator('li[data-role="assistant"]')).toContainText("Wydawaj najwyżej 4 zł dziennie.");
  expect(sent[0].messages).toEqual([{ role: "user", content: "Co zrobić, żeby pieniędzy starczyło do końca miesiąca?" }]);

  // własne pytanie: do API idzie cała dotychczasowa rozmowa
  await page.getByLabel("Twoje pytanie").fill("Czy stać mnie na buty za 300 zł?");
  await page.getByRole("button", { name: "Wyślij" }).click();
  await expect(messages.locator('li[data-role="assistant"]').last()).toContainText("Tak, ale z kategorii Cele.");
  expect(sent[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(sent[1].messages[2].content).toBe("Czy stać mnie na buty za 300 zł?");

  // rozmowa zostaje po odświeżeniu strony, a "Nowa rozmowa" ją czyści
  await page.reload();
  await expect(page.getByTestId("assistant-messages").locator("li")).toHaveCount(4);
  await page.getByRole("button", { name: "Nowa rozmowa" }).click();
  await expect(page.getByTestId("assistant-starters")).toBeVisible();
});

test("asystent AI: błąd zostawia pytanie w polu, a wyłączony asystent mówi o tym wprost", async ({ page }) => {
  await asLoggedIn(page);
  await page.route("**/api/v1/assistant/chat", (r) => json(r, { error: "Asystent nie odpowiedział, spróbuj ponownie za chwilę" }, 502));
  await page.goto("/assistant");
  await page.getByLabel("Twoje pytanie").fill("Ile mogę wydać?");
  await page.getByRole("button", { name: "Wyślij" }).click();
  await expect(page.getByText("Asystent nie odpowiedział, spróbuj ponownie za chwilę")).toBeVisible();
  await expect(page.getByLabel("Twoje pytanie")).toHaveValue("Ile mogę wydać?");
  await expect(page.getByTestId("assistant-starters")).toBeVisible(); // nieudane pytanie nie zostaje w rozmowie
});

test("asystent AI: wyłączony na serwerze i wymóg konta", async ({ page }) => {
  await asLoggedIn(page, false);
  await page.goto("/assistant");
  await expect(page.getByTestId("assistant-off")).toContainText("nie jest jeszcze włączony na serwerze");
  await expect(page.getByLabel("Twoje pytanie")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Wyślij" })).toBeDisabled();
});

test("asystent AI bez konta: zachęta do logowania", async ({ page }) => {
  await withLocalProfile(page);
  await page.goto("/assistant");
  await expect(page.getByText("Asystent AI jest dostępne po zalogowaniu.")).toBeVisible();
});
