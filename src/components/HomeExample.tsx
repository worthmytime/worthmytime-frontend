"use client";

import { CheckIcon, Gamepad2Icon } from "lucide-react";
import { money, num } from "@/lib/format";
import { effectiveRate, hoursPerMonth, netIncome } from "@/lib/rates";
import { useApp } from "./AppProvider";

/** Cena przykładowego zakupu na stronie głównej. */
const PRICE = 2500;

/** Przykładowa osoba dla kogoś, kto nie podał jeszcze swojej stawki: 10 000 zł netto, 8 h dziennie, 5 dni w tygodniu. */
const SAMPLE = { rate: 57.69, hoursPerDay: 8, daysPerWeek: 5, income: 10000, currency: "PLN" };

/** Dopisek pod przyciskami: zachęta bez konta, a dla zalogowanego informacja, że jego dane już są. */
export function HomeAccountNote() {
  const { ready, loggedIn } = useApp();
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground" data-testid="home-account-note">
      <CheckIcon className="size-4 text-primary" aria-hidden />
      {ready && loggedIn ? "Jesteś zalogowany: historia, budżet i wydatki czekają w aplikacji." : "Bez rejestracji. Konto potrzebne dopiero do zapisu historii."}
    </p>
  );
}

/** Przykładowy wynik: policzony z profilu użytkownika, jeśli go ma, a inaczej dla przykładowej osoby. */
export function HomeExample() {
  const { ready, profile } = useApp();
  const ownRate = ready && profile ? (profile.effective_hourly_rate ?? effectiveRate(profile)) : null;
  const own = ownRate != null && ownRate > 0 && profile != null;
  const rate = own ? ownRate : SAMPLE.rate;
  const hoursPerDay = own ? profile.hours_per_day : SAMPLE.hoursPerDay;
  const daysPerWeek = own ? profile.days_per_week : SAMPLE.daysPerWeek;
  const monthHours = own ? hoursPerMonth(profile) : (SAMPLE.hoursPerDay * SAMPLE.daysPerWeek * 52) / 12;
  const income = own ? (netIncome(profile) ?? rate * monthHours) : SAMPLE.income;
  const hours = PRICE / rate;
  const days = hours / hoursPerDay;
  const example = {
    own,
    rate,
    hours,
    currency: own ? profile.currency : SAMPLE.currency,
    percent: income > 0 ? (PRICE / income) * 100 : 0,
    tiles: [
      [num(days, 1), "dnia roboczego"],
      [num(days / daysPerWeek, 1), "tyg. roboczego"],
      [num(hours / monthHours, 2), "miesiąca pracy"],
    ],
  };

  return (
    <div
      aria-label={example.own ? "Przykład dla Twojej stawki" : "Przykładowy wynik"}
      role="group"
      className="relative isolate grid max-w-[480px] gap-5 overflow-hidden rounded-[28px] bg-brand p-7 text-brand-foreground shadow-[0_30px_60px_-30px] shadow-brand md:justify-self-end"
    >
      <svg
        aria-hidden
        width="320"
        height="320"
        viewBox="0 0 320 320"
        fill="none"
        className="pointer-events-none absolute -top-[120px] -right-[120px] -z-10"
      >
        <circle cx="160" cy="160" r="150" stroke="#ffffff12" strokeWidth="2" />
        <circle cx="160" cy="160" r="110" stroke="#ffffff0d" strokeWidth="2" />
        <circle cx="160" cy="160" r="70" stroke="#ffffff0a" strokeWidth="2" />
      </svg>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-[14px] bg-white/10">
          <Gamepad2Icon className="size-[22px] text-lime" aria-hidden />
        </span>
        <div>
          <div className="text-sm text-brand-muted">PlayStation 5</div>
          <div className="text-lg font-semibold tabular-nums">{money(PRICE, example.currency)}</div>
        </div>
      </div>
      <div>
        <div className="text-sm text-brand-muted">kosztuje Cię</div>
        <div className="font-heading text-[5.5rem] leading-[0.95] font-extrabold tracking-[-0.045em] text-lime tabular-nums sm:text-[6.5rem]">
          {num(example.hours, 1)}
          <span className="ml-1.5 text-[2.5rem] font-bold tracking-normal">h</span>
        </div>
        <div className="mt-1.5 text-sm text-brand-muted" data-testid="home-rate">
          pracy przy {example.own ? "Twojej stawce" : "stawce"} {money(example.rate, example.currency)}/h
        </div>
      </div>
      <div className="flex items-center gap-4 rounded-[18px] bg-white/[0.07] px-4 py-3.5">
        <div className="relative size-16 flex-none">
          <svg width="64" height="64" viewBox="0 0 120 120" aria-hidden>
            <circle cx="60" cy="60" r="50" fill="none" stroke="#ffffff26" strokeWidth="14" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="#b8f26b"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${(Math.min(example.percent, 100) / 100) * 314.2} 314.2`}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-sm font-bold">{num(example.percent, 0)}%</span>
        </div>
        <div>
          <div className="text-[17px] leading-snug font-semibold">To {num(example.percent, 0)}% {example.own ? "Twojej miesięcznej" : "miesięcznej"} wypłaty</div>
          <div className="mt-0.5 text-[13px] text-brand-muted">Tyle z miesięcznej pracy pochłania ten wydatek.</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {example.tiles.map(([v, l]) => (
          <div key={l} className="rounded-2xl border border-white/10 bg-white/[0.06] px-1 py-3">
            <div className="font-heading text-[22px] font-bold tabular-nums">{v}</div>
            <div className="text-xs text-brand-muted">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
