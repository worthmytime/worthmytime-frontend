"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { HourglassIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/AppProvider";
import { Field } from "@/components/FormField";
import LoginPrompt from "@/components/LoginPrompt";
import OnboardingCard from "@/components/OnboardingCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { suggestCategory } from "@/lib/ai";
import { api, type BudgetState, type Category, type WishlistItem, type WishlistStats } from "@/lib/api";
import { CATEGORY_INFO, money, num } from "@/lib/format";
import { BUDGET_CATEGORIES, errorMessage, requiredNumber } from "@/lib/forms";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę").max(200),
  price: requiredNumber("Cena").refine((n) => n > 0, "Cena musi być większa od zera"),
  cooldown_days: requiredNumber("Okres").refine((n) => Number.isInteger(n) && n >= 0 && n <= 365, "Od 0 do 365 dni"),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const COOLDOWNS = [7, 14, 30, 60];

interface Payload {
  items: WishlistItem[];
  stats: WishlistStats;
  currency: string;
}

export default function WishlistPage() {
  const { ready, loggedIn, profile } = useApp();
  // pozycja rozstrzygnięta, przy której czeka potwierdzenie usunięcia
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  // potwierdzenie zakupu: pozycja, przy której pytamy, czy dopisać wydatek i w jakiej kategorii
  const [buying, setBuying] = useState<{ id: string; addExpense: boolean; category: Category } | null>(null);
  const [available, setAvailable] = useState<Record<Category, number> | null>(null);
  const [suggestedCategory, setSuggestedCategory] = useState<Category | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", price: "", cooldown_days: "30" },
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const load = useCallback(
    () =>
      Promise.all([
        api<Payload>("/wishlist").then(setData),
        // dostępne środki kategorii służą tylko do podpowiedzi przy zakupie, więc ich brak niczego nie blokuje
        api<BudgetState>("/budget")
          .then((b) => setAvailable(b.available))
          .catch(() => setAvailable(null)),
      ]).catch((e) => toast.error(errorMessage(e, "Nie udało się pobrać listy życzeń"))),
    [],
  );

  useEffect(() => {
    if (loggedIn && profile) void load();
  }, [loggedIn, profile, load]);

  if (!ready) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (!loggedIn) return <LoginPrompt what="Lista życzeń" />;
  if (!profile) return <OnboardingCard />;

  async function suggestWishlistCategory() {
    const name = getValues("name").trim();
    if (!name) return;
    setSuggesting(true);
    try {
      const suggestion = await suggestCategory(name);
      setSuggestedCategory(suggestion);
    } catch {
      // best-effort
    } finally {
      setSuggesting(false);
    }
  }

  async function submit(v: FormOut) {
    try {
      await api("/wishlist", {
        body: { ...v, ...(suggestedCategory ? { category: suggestedCategory } : {}) },
      });
      toast.success("Dodano do listy życzeń");
      setSuggestedCategory(null);
      reset({ name: "", price: "", cooldown_days: getValues("cooldown_days") });
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Nie udało się dodać"));
    }
  }

  async function decide(item: WishlistItem, decision: "BOUGHT" | "DROPPED") {
    // zakup pyta wcześniej, czy dopisać wydatek (i do której kategorii); odpuszczenie niczego nie dopisuje
    const expense = decision === "BOUGHT" && buying?.id === item.id ? buying : null;
    const body =
      decision === "BOUGHT"
        ? { decision, add_expense: !!expense?.addExpense, ...(expense?.addExpense ? { category: expense.category } : {}) }
        : { decision };
    try {
      await api(`/wishlist/${item.id}/decision`, { body });
      setBuying(null);
      toast.success(
        decision === "DROPPED"
          ? "Odpuszczone - dobra decyzja dla Twojego czasu"
          : expense?.addExpense
            ? "Zapisano jako kupione i dopisano do wydatków"
            : "Zapisano jako kupione",
      );
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** Cofnięcie decyzji: pozycja wraca do oczekujących, a wydatek dopisany przy zakupie znika z rejestru. */
  async function undo(item: WishlistItem) {
    try {
      await api(`/wishlist/${item.id}/decision`, { method: "DELETE" });
      toast.success(item.status === "BOUGHT" ? "Zakup cofnięty, wydatek usunięty z rejestru" : "Decyzja cofnięta");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** Jednym zdaniem: jak zakup zmieni dostępne środki wybranej kategorii. */
  function impact(price: number, category: Category) {
    const label = CATEGORY_INFO[category].label;
    if (!available) return `Wydatek obciąży budżet kategorii ${label}.`;
    const left = available[category] - price;
    return left >= 0
      ? `W kategorii ${label} zostanie ${money(left, currency)} z ${money(available[category], currency)} dostępnych w tym miesiącu.`
      : `Zakup przekroczy dostępne środki kategorii ${label} o ${money(-left, currency)} (dostępne: ${money(available[category], currency)}).`;
  }

  async function remove(item: WishlistItem) {
    try {
      await api(`/wishlist/${item.id}`, { method: "DELETE" });
      setConfirmId(null);
      await load();
      toast.success(`Usunięto: ${item.name}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const currency = data?.currency ?? profile.currency;
  const waiting = data?.items.filter((i) => i.status === "WAITING") ?? [];
  const decided = data?.items.filter((i) => i.status !== "WAITING") ?? [];
  const stats = data?.stats;

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lista życzeń</h1>
        <p className="text-sm text-muted-foreground">
          Zapisz, na co masz ochotę, i odczekaj. Po okresie ostygnięcia zdecyduj spokojnie - bez przypomnień mailowych, wszystko jest tutaj.
        </p>
      </div>

      {stats && stats.dropped_count > 0 && (
        <Card className="bg-gradient-to-br from-primary/15 via-card to-card" data-testid="wish-savings">
          <CardContent className="grid gap-1 text-center">
            <p className="text-sm text-muted-foreground">Dzięki odpuszczeniu zaoszczędziłeś</p>
            <p className="text-3xl font-bold tabular-nums text-primary">{money(stats.dropped_total, currency)}</p>
            <p className="text-sm text-muted-foreground">
              czyli <b className="text-foreground">{num(stats.dropped_hours, 1)} h</b> swojej pracy ({stats.dropped_count}{" "}
              {stats.dropped_count === 1 ? "rzecz" : "rzeczy"})
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dodaj do listy</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
            <Field label="Co chcesz kupić?" error={errors.name?.message}>
              {(p) => <Input {...p} placeholder="np. PlayStation" autoComplete="off" className="h-11" {...register("name")} />}
            </Field>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">Kategoria budżetu (opcjonalnie)</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  disabled={suggesting || !watch("name").trim()}
                  onClick={suggestWishlistCategory}
                >
                  <SparklesIcon className="size-3.5" />
                  {suggesting ? "Analizuję..." : "Zaproponuj AI"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Kategoria budżetu">
                {BUDGET_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={suggestedCategory === c}
                    onClick={() => setSuggestedCategory((prev) => (prev === c ? null : c))}
                    className={`min-h-9 rounded-lg border px-2 text-sm font-medium transition-colors ${
                      suggestedCategory === c
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {CATEGORY_INFO[c].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cena" error={errors.price?.message}>
                {(p) => <Input {...p} inputMode="decimal" placeholder="2500" className="h-11" {...register("price")} />}
              </Field>
              <Field label="Odczekaj (dni)" error={errors.cooldown_days?.message}>
                {(p) => <Input {...p} inputMode="numeric" className="h-11" {...register("cooldown_days")} />}
              </Field>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Szybki wybór okresu">
              {COOLDOWNS.map((d) => (
                <Button key={d} type="button" variant="outline" size="sm" onClick={() => setValue("cooldown_days", String(d))}>
                  {d} dni
                </Button>
              ))}
            </div>
            <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
              Dodaj do listy życzeń
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-3" aria-label="Czeka na decyzję">
        <h2 className="text-lg font-semibold">Czeka na decyzję ({waiting.length})</h2>
        {data === null && <Skeleton className="h-24" />}
        {data && waiting.length === 0 && <p className="text-sm text-muted-foreground">Lista jest pusta.</p>}
        {waiting.map((i) => {
          const progress = i.cooldown_days === 0 ? 100 : Math.min(100, ((i.cooldown_days - i.days_left) / i.cooldown_days) * 100);
          return (
            <Card key={i.id} size="sm" data-testid={`wish-${i.id}`} data-ready={i.ready}>
              <CardContent className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {money(i.price, currency)} · <b className="text-foreground">{num(i.work?.hours ?? 0, 1)} h</b> pracy
                    </p>
                  </div>
                  <Button variant="ghost" className="size-10" aria-label={`Usuń ${i.name}`} onClick={() => remove(i)}>
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <HourglassIcon className="size-3" aria-hidden />
                      {i.ready ? "Gotowe do decyzji" : `Jeszcze ${i.days_left} ${i.days_left === 1 ? "dzień" : "dni"} ostygnięcia`}
                    </span>
                    <span>{i.cooldown_days} dni</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Postęp ostygnięcia">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                {i.ready && <p className="text-sm font-medium">Nadal tego chcesz, mając w głowie {num(i.work?.hours ?? 0, 1)} h swojej pracy?</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="h-10" onClick={() => decide(i, "DROPPED")}>
                    Odpuszczam
                  </Button>
                  {i.ready && (
                    <Button
                      className="h-10"
                      aria-expanded={buying?.id === i.id}
                      onClick={() => setBuying(buying?.id === i.id ? null : { id: i.id, addExpense: true, category: i.category ?? "FUN" })}
                    >
                      Kupuję
                    </Button>
                  )}
                </div>
                {buying?.id === i.id && (
                  <div className="grid gap-3 rounded-lg bg-muted/60 p-3 text-sm" role="group" aria-label={`Potwierdź zakup: ${i.name}`}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0"
                        checked={buying.addExpense}
                        onChange={(e) => setBuying({ ...buying, addExpense: e.target.checked })}
                      />
                      <span>Dopisz zakup do wydatków ({money(i.price, currency)})</span>
                    </label>
                    {buying.addExpense ? (
                      <>
                        <div role="radiogroup" aria-label="Kategoria wydatku" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {BUDGET_CATEGORIES.map((c) => (
                            <button
                              key={c}
                              type="button"
                              role="radio"
                              aria-checked={buying.category === c}
                              onClick={() => setBuying({ ...buying, category: c })}
                              className={cn(
                                "min-h-10 rounded-lg border bg-background px-2 text-sm font-medium transition-colors",
                                buying.category === c ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {CATEGORY_INFO[c].label}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid="buy-impact">
                          {impact(i.price, buying.category)}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground" data-testid="buy-impact">
                        Zakup zostanie tylko odnotowany na liście życzeń, bez wpisu w rejestrze wydatków.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button className="h-10" onClick={() => decide(i, "BOUGHT")}>
                        Potwierdź zakup
                      </Button>
                      <Button variant="outline" className="h-10" onClick={() => setBuying(null)}>
                        Anuluj
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      {decided.length > 0 && (
        <section className="grid gap-3" aria-label="Rozstrzygnięte">
          <h2 className="text-lg font-semibold">Rozstrzygnięte</h2>
          <Card size="sm">
            <CardContent>
              <ul className="divide-y text-sm">
                {decided.map((i) => (
                  <li key={i.id} className="grid gap-2 py-2" data-testid={`decided-${i.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">{i.name}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                        {money(i.price, currency)}
                        <Badge variant={i.status === "DROPPED" ? "secondary" : "outline"}>{i.status === "DROPPED" ? "odpuszczone" : "kupione"}</Badge>
                        <Button variant="ghost" size="sm" aria-label={`Cofnij decyzję: ${i.name}`} onClick={() => undo(i)}>
                          Cofnij
                        </Button>
                        <Button
                          variant="ghost"
                          className="size-9"
                          aria-label={`Usuń rozstrzygniętą pozycję ${i.name}`}
                          aria-expanded={confirmId === i.id}
                          onClick={() => setConfirmId(confirmId === i.id ? null : i.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </span>
                    </div>
                    {confirmId === i.id && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 p-2.5 text-xs" role="group" aria-label={`Potwierdź usunięcie: ${i.name}`}>
                        <span className="min-w-0 flex-1 basis-48 text-muted-foreground">
                          Usunąć „{i.name}” z listy?
                          {i.status === "DROPPED" && " Przestanie się liczyć do zaoszczędzonej kwoty."} Tego nie da się cofnąć.
                        </span>
                        <span className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                            Anuluj
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => remove(i)}>
                            Usuń
                          </Button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
      <CardDescription className="text-center text-xs">
        Godziny pracy liczymy według Twojej aktualnej stawki.
      </CardDescription>
    </div>
  );
}