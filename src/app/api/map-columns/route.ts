import { NextResponse } from "next/server";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

// Requires TYPESAFE_API_KEY in environment (console.typesafe.ai)

/** Pola wydatku, dla których Jev wskazuje kolumnę pliku z historią transakcji. */
const FIELDS = {
  date: "Która kolumna zawiera datę transakcji (datę operacji albo księgowania)?",
  amount:
    "Która kolumna zawiera kwotę transakcji, czyli ile wydano? Nie chodzi o saldo po operacji ani o numer rachunku. " +
    "Jeśli obciążenia i wpływy są w osobnych kolumnach, wybierz kolumnę obciążeń (wydatków).",
  description:
    "Która kolumna najlepiej mówi, na co był wydatek: nazwa sprzedawcy, odbiorca albo tytuł/opis transakcji? " +
    "Nie chodzi o typ operacji (np. przelew, płatność kartą) ani o numer rachunku.",
  currency: "Która kolumna zawiera kod waluty transakcji (np. PLN, EUR)? Jeśli waluta jest tylko doklejona do kwoty, wybierz none.",
} as const;

type Field = keyof typeof FIELDS;

interface Column {
  index: number;
  header: string;
  samples: string[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { columns?: Column[] };
    const columns = (body.columns ?? []).slice(0, 30);
    if (!columns.length) return NextResponse.json({ mapping: {} });

    // każda kolumna to jedna odpowiedź do wyboru, opisana nagłówkiem i przykładami; "none" = pliku brakuje takiej kolumny
    const criteria: Record<string, string> = { none: "żadna kolumna nie pasuje" };
    for (const c of columns) {
      criteria[`c${c.index}`] = `Nagłówek: ${String(c.header).slice(0, 60)}. Przykłady: ${(c.samples ?? []).map((s) => String(s).slice(0, 40)).join(" | ") || "(puste)"}`;
    }
    const questions = {
      date: choice(FIELDS.date, criteria),
      amount: choice(FIELDS.amount, criteria),
      description: choice(FIELDS.description, criteria),
      currency: choice(FIELDS.currency, criteria),
    };

    const client = new TypeSafeClient();
    const { answers } = await client.systemOne({
      state: { dokument: "Nagłówki i przykładowe wiersze pliku z historią transakcji bankowych", kolumny: columns.map((c) => ({ kolumna: `c${c.index}`, naglowek: c.header, przyklady: c.samples })) },
      questions,
    });

    const mapping: Partial<Record<Field, number | null>> = {};
    for (const field of Object.keys(FIELDS) as Field[]) {
      const picked = String(answers[field].choice);
      mapping[field] = picked === "none" ? null : Number(picked.slice(1));
    }
    return NextResponse.json({ mapping });
  } catch (err) {
    console.error("[map-columns]", err);
    return NextResponse.json({ error: "Nie udało się rozpoznać kolumn" }, { status: 500 });
  }
}
