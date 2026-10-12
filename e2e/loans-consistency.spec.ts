import { expect, test } from "@playwright/test";
import { withLocalLedger, withLocalProfile } from "./mocks";

/**
 * 20 października. Pożyczka z ostatnią ratą 11.10 (540,18 zł) nadal obciąża ten miesiąc,
 * a pożyczka spłacona w sierpniu (300 zł) nie liczy się wcale. W rejestrze 1 000 zł w Potrzebach.
 */
test("raty liczone tak samo na Wydatkach, w Budżecie i w alertach", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00"));
  await withLocalProfile(page);
  await withLocalLedger(page, [{ category: "NEEDS", amount: 1000, note: "czynsz" }]);
  await page.addInitScript(() => {
    const loans = [
      { name: "Pożyczka", installment_amount: 540.18, start_date: "2025-10-11", end_date: "2026-10-11", payment_day: 11 },
      { name: "Stara pożyczka", installment_amount: 300, start_date: "2025-08-11", end_date: "2026-08-11", payment_day: 11 },
    ];
    window.localStorage.setItem(
      "wmt_budget",
      JSON.stringify({ percentages: { NEEDS: 50, FUTURE: 25, GOALS: 15, FUN: 10 }, spent: { NEEDS: 0, FUTURE: 0, GOALS: 0, FUN: 0 }, loans }),
    );
  });

  // Wydatki: Potrzeby = 1 000 zł z rejestru + 540,18 zł raty; suma miesiąca zgadza się z kategoriami
  await page.goto("/expenses");
  await expect(page.getByTestId("usage-NEEDS")).toContainText(/1\s540,18\szł \/ 3\s500,00\szł/);
  await expect(page.getByTestId("month-total")).toHaveText(/1\s540,18\szł/);

  // karta kredytów (na Wydatkach) wyjaśnia, co jest liczone
  await expect(page.getByTestId("loan-summary-0")).toContainText("Ostatnia rata wypadła w tym miesiącu");
  await expect(page.getByTestId("loan-summary-1")).toContainText("uznajemy za spłacony");

  // dzwonek: ostatnia rata nie jest oznaczona jako zapłacona, więc alert zostaje po terminie
  await page.getByTestId("alerts-bell").click();
  const alert = page.getByTestId("alert-LOAN_DUE:local:Pożyczka:540.18");
  await expect(alert).toHaveAttribute("data-level", "critical");
  await expect(alert).toContainText("Termin minął 11 października 2026 (9 dni temu)");
  await expect(page.getByTestId("alert-LOAN_DUE:local:Stara pożyczka:300")).toHaveCount(0);

  // Budżet: ta sama kwota w Potrzebach
  await page.goto("/budget");
  await expect(page.getByTestId("budget-NEEDS")).toContainText(/wydane \(rejestr \+ raty\): 1\s540,18\szł/);
  await expect(page.getByTestId("loans-total")).toContainText(/540,18\szł/);
});
