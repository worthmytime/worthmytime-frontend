"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { HeartIcon, SaveIcon, Settings2Icon, TargetIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import CalculationFields from "@/components/CalculationFields";
import OnboardingCard from "@/components/OnboardingCard";
import ResultView from "@/components/ResultView";
import ShareControl from "@/components/ShareControl";
import WhatIfCard from "@/components/WhatIfCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type CalculationIn, type Result, type SavedCalculation } from "@/lib/api";
import { effectiveRate } from "@/lib/rates";
import { money } from "@/lib/format";
import {
  applyServerErrors,
  calcFromForm,
  calcToForm,
  calculationSchema,
  emptyCalcForm,
  errorMessage,
  type CalcFormIn,
  type CalcFormOut,
} from "@/lib/forms";

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Calculator />
    </Suspense>
  );
}

function Calculator() {
  const { ready, profile, profileForRequest, budgetForRequest, loggedIn } = useApp();
  const router = useRouter();
  const editId = useSearchParams().get("edit");

  const form = useForm<CalcFormIn, unknown, CalcFormOut>({
    resolver: zodResolver(calculationSchema),
    defaultValues: emptyCalcForm(),
  });
  const [result, setResult] = useState<(Result & { currency?: string }) | null>(null);
  const [saved, setSaved] = useState<SavedCalculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCalc, setLastCalc] = useState<CalculationIn | null>(null);
  // co już dodano z bieżącego wyniku: drugi klik nie może utworzyć duplikatu na liście życzeń ani drugiego celu
  const [added, setAdded] = useState({ wishlist: false, goal: false });
  const { isDirty } = form.formState;

  useEffect(() => {
    if (!editId || !loggedIn) return;
    api<SavedCalculation>(`/calculations/${editId}`)
      .then((s) => {
        form.reset(calcToForm(s.input));
        setSaved(s);
        setLastCalc(s.input);
        setResult({ ...s.result, currency: s.currency });
      })
      .catch((e) => toast.error(errorMessage(e, "Nie udało się wczytać obliczenia")));
  }, [editId, loggedIn, form]);

  if (!ready) return <Skeleton className="h-96 w-full" />;
  if (!profile) return <OnboardingCard />;

  const currency = profile.currency;
  const rate = profile.effective_hourly_rate ?? effectiveRate(profile);

  function showResult() {
    // na telefonie wynik jest pod formularzem - przewiń do niego
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) {
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  async function run(values: CalcFormOut) {
    setBusy(true);
    try {
      const calculation = calcFromForm(values);
      const res = await api<Result>("/calculate", {
        body: { profile: profileForRequest, budget: budgetForRequest, calculation },
      });
      setLastCalc(calculation);
      setResult(res);
      setAdded({ wishlist: false, goal: false }); // nowy wynik to nowa pozycja
      showResult();
    } catch (e) {
      if (!applyServerErrors(e, form.setError)) toast.error(errorMessage(e, "Błąd obliczeń"));
    } finally {
      setBusy(false);
    }
  }

  /** Cena do listy życzeń i celu: część jednorazowa zakupu (bez kosztów utrzymania). */
  async function addToWishlist() {
    if (!lastCalc || !(lastCalc.purchase_price > 0) || added.wishlist) return;
    setAdded((a) => ({ ...a, wishlist: true })); // od razu, żeby szybki drugi klik niczego nie wysłał
    try {
      await api("/wishlist", { body: { name: lastCalc.name, price: lastCalc.purchase_price, category: lastCalc.category ?? null } });
      toast.success("Dodano do listy życzeń - zdecyduj po okresie ostygnięcia");
    } catch (e) {
      setAdded((a) => ({ ...a, wishlist: false }));
      toast.error(errorMessage(e, "Nie udało się dodać do listy życzeń"));
    }
  }

  async function saveAsGoal() {
    if (!lastCalc || !(lastCalc.purchase_price > 0) || added.goal) return;
    setAdded((a) => ({ ...a, goal: true }));
    try {
      await api("/goals", {
        body: {
          name: lastCalc.name,
          target_amount: lastCalc.purchase_price,
          saved_amount: lastCalc.already_saved ?? 0,
          monthly_contribution: lastCalc.monthly_contribution ?? null,
          category: lastCalc.category ?? null,
        },
      });
      toast.success("Zapisano jako cel oszczędnościowy");
    } catch (e) {
      setAdded((a) => ({ ...a, goal: false }));
      toast.error(errorMessage(e, "Nie udało się zapisać celu"));
    }
  }

  async function save() {
    const ok = await form.trigger();
    if (!ok) return;
    const body = calcFromForm(calculationSchema.parse(form.getValues()));
    setBusy(true);
    try {
      const s = saved
        ? await api<SavedCalculation>(`/calculations/${saved.id}`, { method: "PUT", body })
        : await api<SavedCalculation>("/calculations", { body });
      setSaved(s);
      setResult({ ...s.result, currency: s.currency });
      toast.success(saved ? "Zmiany zapisane" : "Zapisano w historii");
      form.reset(form.getValues()); // zapisany stan staje się punktem odniesienia: "Zapisz zmiany" czeka na kolejną zmianę
      if (!editId) router.replace(`/calculator?edit=${s.id}`, { scroll: false }); // bez przewijania na górę strony
    } catch (e) {
      if (!applyServerErrors(e, form.setError)) toast.error(errorMessage(e, "Nie udało się zapisać"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3 px-1 text-sm">
          <span className="text-muted-foreground">
            Twoja godzina pracy: <b className="text-foreground">{rate != null ? money(rate, currency) : "-"}</b>
          </span>
          {/* profil finansowy edytuje się na stronie Profil, a ta przed zalogowaniem pokazuje tylko logowanie */}
          {loggedIn && (
            <Link href="/profile" className="inline-flex items-center gap-1 text-primary hover:underline">
              <Settings2Icon className="size-3.5" /> Zmień
            </Link>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{saved ? "Edytuj obliczenie" : "Ile to naprawdę kosztuje?"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(run)} noValidate className="grid gap-5">
              <CalculationFields form={form} />
              <Button type="submit" size="lg" className="h-12 text-base" disabled={busy}>
                {busy ? "Liczę…" : "Oblicz"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div id="result" className="grid scroll-mt-20 gap-3">
        {result ? (
          <>
            <ResultView result={result} currency={result.currency ?? currency} />
            <Card size="sm">
              <CardContent className="grid gap-3">
                {loggedIn ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {lastCalc && lastCalc.type !== "RECURRING" && lastCalc.purchase_price > 0 && (
                        <>
                          <Button variant="outline" className="h-11" onClick={addToWishlist} disabled={added.wishlist}>
                            <HeartIcon /> {added.wishlist ? "Dodano do listy życzeń" : "Dodaj do listy życzeń"}
                          </Button>
                          <Button variant="outline" className="h-11" onClick={saveAsGoal} disabled={added.goal}>
                            <TargetIcon /> {added.goal ? "Zapisano jako cel" : "Zapisz jako cel"}
                          </Button>
                        </>
                      )}
                      <Button className="h-11" onClick={save} disabled={busy || (saved != null && !isDirty)} title={saved && !isDirty ? "Brak zmian do zapisania" : undefined}>
                        <SaveIcon /> {saved ? "Zapisz zmiany" : "Zapisz w historii"}
                      </Button>
                      {saved && (
                        <ShareControl
                          calculationId={saved.id}
                          publicId={saved.public_id}
                          onChange={(public_id) => setSaved({ ...saved, public_id })}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <Link href="/profile" className="font-medium text-primary underline">
                      Zaloguj się
                    </Link>
                    , aby zapisać wynik w historii i udostępnić go innym.
                  </p>
                )}
              </CardContent>
            </Card>
            {lastCalc && <WhatIfCard profile={profile} calculation={lastCalc} base={result} />}
          </>
        ) : (
          <Card className="hidden border-dashed bg-transparent shadow-none lg:block">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Tutaj pojawi się wynik: ile godzin pracy kosztuje ten zakup.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
