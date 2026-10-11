import { NextResponse } from "next/server";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Category } from "@/lib/api";

// Requires TYPESAFE_API_KEY in environment (console.typesafe.ai)
const INSTRUCTIONS =
  "Przypisz wydatek do kategorii budżetowej. " +
  "NEEDS = Potrzeby: czynsz, wynajem, jedzenie, supermarket, biedronka, lidl, media, paliwo, transport konieczny, leczenie, apteka, ubezpieczenie, zobowiązania kredytowe, rachunki. " +
  "FUTURE = Przyszłość: oszczędności, lokata, inwestycje, emerytura, poduszka finansowa, rezerwa awaryjna. " +
  "GOALS = Cele: wakacje, podróże, samochód, elektronika, meble, remont, większy jednorazowy zakup, na który się odkłada. " +
  "FUN = Przyjemności: restauracje, kawiarnia, fast food, rozrywka, kino, teatr, siłownia, gry, streaming, netflix, spotify, hobby, spontaniczne zakupy, subskrypcje.";

const CRITERIA = { NEEDS: null, FUTURE: null, GOALS: null, FUN: null } as const;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items?: { key: string; description: string }[] };
    const items = body.items ?? [];
    if (!items.length) return NextResponse.json({ suggestions: {} });

    const client = new TypeSafeClient();
    const document = items.map((item, i) => `${i + 1}. ${item.description}`).join("\n");

    const questions = Object.fromEntries(
      items.map((_, i) => [`q${i}`, choice(INSTRUCTIONS, CRITERIA)]),
    );

    const { answers } = await client.systemOne({ state: { document }, questions });

    const suggestions: Record<string, Category> = Object.fromEntries(
      items.map((item, i) => [item.key, (answers[`q${i}`] as { choice: Category }).choice]),
    );

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("[categorize]", err);
    return NextResponse.json({ error: "Nie udało się zasugerować kategorii" }, { status: 500 });
  }
}
