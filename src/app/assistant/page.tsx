"use client";

import { SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/AppProvider";
import LoginPrompt from "@/components/LoginPrompt";
import OnboardingCard from "@/components/OnboardingCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type AssistantMessage } from "@/lib/api";
import { errorMessage } from "@/lib/forms";
import { cn } from "@/lib/utils";

/** Tyle wiadomości przyjmuje API w jednej rozmowie; starsze odcinamy przy wysyłaniu. */
const MAX_MESSAGES = 30;
const MAX_LENGTH = 2000;
const STORAGE_KEY = "wmt_assistant_chat";

const STARTERS = [
  "Co zrobić, żeby pieniędzy starczyło do końca miesiąca?",
  "Ile mogę jeszcze wydać dziennie w każdej kategorii?",
  "Gdzie w tym miesiącu mogę najłatwiej zaoszczędzić?",
  "Którą ratę opłacić najpierw i czy mnie na to stać?",
];

/** Rozmowa przetrwa przejście na inną stronę w tej samej karcie; na serwerze nie jest zapisywana. */
function readChat(): AssistantMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AssistantMessage[]) : [];
  } catch {
    return [];
  }
}

function writeChat(messages: AssistantMessage[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {}
}

/** Asystent AI: czat na całą stronę. Dane bieżącego miesiąca dokłada serwer przy każdym pytaniu. */
export default function AssistantPage() {
  const { ready, loggedIn, profile } = useApp();
  const [messages, setMessages] = useState<AssistantMessage[]>(readChat);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  // co widzi asystent i czy jest włączony na serwerze; null = jeszcze nie wiemy
  const [info, setInfo] = useState<{ context: string[]; configured: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loggedIn || !profile) return;
    let cancelled = false;
    api<{ context: string[]; configured: boolean }>("/assistant/context")
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch(() => {
        if (!cancelled) setInfo({ context: [], configured: false });
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, profile]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, waiting]);

  if (!ready) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (!loggedIn) return <LoginPrompt what="Asystent AI" />;
  if (!profile) return <OnboardingCard />;

  const disabled = waiting || info?.configured === false;

  async function send(text: string) {
    const content = text.trim().slice(0, MAX_LENGTH);
    if (!content || disabled) return;
    const next: AssistantMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    writeChat(next);
    setDraft("");
    setWaiting(true);
    try {
      const { reply } = await api<{ reply: string }>("/assistant/chat", { body: { messages: next.slice(-MAX_MESSAGES) } });
      const withReply: AssistantMessage[] = [...next, { role: "assistant", content: reply }];
      setMessages(withReply);
      writeChat(withReply);
    } catch (e) {
      // pytanie zostaje w rozmowie i wraca do pola, żeby można je było wysłać ponownie
      setMessages(messages);
      writeChat(messages);
      setDraft(content);
      toast.error(errorMessage(e, "Asystent nie odpowiedział"));
    } finally {
      setWaiting(false);
    }
  }

  function reset() {
    setMessages([]);
    writeChat([]);
    setDraft("");
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <SparklesIcon className="size-5 text-primary" aria-hidden /> Asystent AI
          </h1>
          <p className="text-sm text-muted-foreground">
            Zna Twoje wydatki z tego miesiąca i podpowiada, jak je poprowadzić, żeby pieniędzy starczyło do końca miesiąca.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={reset} disabled={waiting}>
            Nowa rozmowa
          </Button>
        )}
      </div>

      {info?.configured === false && (
        <Card size="sm" className="border-dashed" data-testid="assistant-off">
          <CardContent className="text-sm">
            Asystent nie jest jeszcze włączony na serwerze. Administrator musi ustawić klucz i nazwę modelu w konfiguracji backendu.
          </CardContent>
        </Card>
      )}

      <details className="rounded-xl border bg-card px-4 py-3 text-sm" data-testid="assistant-context">
        <summary className="cursor-pointer font-medium">Co widzi asystent</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Te dane z bieżącego miesiąca i treść rozmowy trafiają do zewnętrznego modelu językowego. Nie wysyłamy adresu e-mail ani hasła. Rozmowa nie
          jest zapisywana na serwerze.
        </p>
        {info == null ? (
          <Skeleton className="mt-2 h-16 w-full" />
        ) : info.context.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Nie udało się pobrać podsumowania miesiąca.</p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {info.context.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </details>

      <Card>
        <CardHeader className={cn(messages.length > 0 && "sr-only")}>
          <CardTitle className="text-base">Zacznij od pytania</CardTitle>
          <CardDescription>Wybierz jedno z gotowych albo napisz własne.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {messages.length === 0 ? (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="assistant-starters">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={disabled}
                  onClick={() => void send(q)}
                  className="min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          ) : (
            <ol className="grid gap-3" aria-live="polite" aria-label="Rozmowa z asystentem" data-testid="assistant-messages">
              {messages.map((m, i) => (
                <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")} data-role={m.role}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    <span className="sr-only">{m.role === "user" ? "Ty: " : "Asystent: "}</span>
                    {m.content}
                  </div>
                </li>
              ))}
              {waiting && (
                <li className="flex justify-start" data-testid="assistant-waiting">
                  <div className="rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">Asystent pisze…</div>
                </li>
              )}
            </ol>
          )}
          <div ref={endRef} />

          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="assistant-input" className="text-sm font-medium">
              Twoje pytanie
            </label>
            <textarea
              id="assistant-input"
              rows={2}
              maxLength={MAX_LENGTH}
              value={draft}
              disabled={info?.configured === false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter wysyła, Shift+Enter robi nową linię
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="np. Czy stać mnie w tym miesiącu na wydatek za 300 zł?"
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">To pomoc w planowaniu, a nie porada finansowa. Enter wysyła, Shift+Enter dodaje linię.</p>
              <Button type="submit" className="h-11 px-5" disabled={disabled || draft.trim() === ""}>
                {waiting ? "Czekam na odpowiedź…" : "Wyślij"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
