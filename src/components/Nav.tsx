"use client";

import {
  CalculatorIcon,
  ClockIcon,
  EllipsisIcon,
  HeartIcon,
  HistoryIcon,
  HourglassIcon,
  InfoIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PiggyBankIcon,
  ReceiptIcon,
  RepeatIcon,
  ScaleIcon,
  TargetIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { money } from "@/lib/format";
import { useMonthBalance } from "@/lib/use-balance";
import { cn } from "@/lib/utils";
import AlertsBell from "./AlertsBell";
import { useApp } from "./AppProvider";
import ThemeToggle from "./ThemeToggle";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Najczęstsze akcje: zawsze na wierzchu (pasek dolny na telefonie i w menu na komputerze). */
const primary: Item[] = [
  { href: "/calculator", label: "Kalkulator", icon: CalculatorIcon },
  { href: "/budget", label: "Budżet", icon: PiggyBankIcon },
  { href: "/expenses", label: "Wydatki", icon: ReceiptIcon },
  { href: "/wishlist", label: "Życzenia", icon: HeartIcon },
];

/** Reszta schowana pod "Więcej", żeby pasek nie puchł. */
const more: Item[] = [
  { href: "/goals", label: "Cele", icon: TargetIcon },
  { href: "/compare", label: "Porównaj", icon: ScaleIcon },
  { href: "/summary", label: "Podsumowanie", icon: ClockIcon },
  { href: "/history", label: "Historia", icon: HistoryIcon },
  { href: "/activity", label: "Zdarzenia", icon: InfoIcon },
  { href: "/subscriptions", label: "Subskrypcje", icon: RepeatIcon },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/profile", label: "Profil", icon: UserRoundIcon },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export default function Nav() {
  const path = usePathname();
  const { email, logout, profile } = useApp();
  const balance = useMonthBalance();
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreActive = more.some((m) => isActive(path, m.href));

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-xl font-bold tracking-tight" aria-label="WorthMyTime - strona główna">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-lime">
              <HourglassIcon className="size-[18px]" />
            </span>
            <span aria-hidden>
              Worth<span className="text-primary">My</span>Time
            </span>
          </Link>

          <nav aria-label="Główna nawigacja" className="ml-4 hidden items-center gap-1 lg:flex">
            {primary.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(path, href) ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  isActive(path, href)
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                      moreActive
                        ? "bg-brand text-brand-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  />
                }
              >
                Więcej <EllipsisIcon className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {more.map(({ href, label, icon: Icon }) => (
                  <DropdownMenuItem key={href} render={<Link href={href} />}>
                    <Icon /> {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {balance != null && (
              <Link
                href="/expenses"
                title="Zostało w tym miesiącu: dochód minus wydatki i raty"
                aria-label={`Zostało w tym miesiącu: ${money(balance, profile?.currency)}`}
                className={cn(
                  "mr-1 inline-flex h-9 items-center rounded-full border bg-card px-3 text-sm font-semibold whitespace-nowrap tabular-nums hover:border-foreground",
                  balance < 0 && "border-destructive/40 text-destructive",
                )}
                data-testid="nav-balance"
              >
                {money(balance, profile?.currency)}
              </Link>
            )}
            {email ? (
              <>
                <Link
                  href="/profile"
                  aria-label="Konto i ustawienia"
                  title={email}
                  className="grid size-9 place-items-center rounded-full border bg-card text-sm font-bold text-primary"
                >
                  {email.charAt(0).toUpperCase()}
                </Link>
                <Button variant="ghost" size="icon" onClick={logout} className="hidden sm:inline-flex" aria-label="Wyloguj">
                  <LogOutIcon />
                </Button>
              </>
            ) : (
              <Link
                href="/profile"
                className="inline-flex h-10 items-center rounded-full border border-input bg-card px-4 text-sm font-semibold hover:border-foreground"
              >
                Zaloguj się
              </Link>
            )}
            <AlertsBell />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Telefon i tablet: dolny pasek z kciukowymi celami dotyku */}
      <nav
        aria-label="Nawigacja mobilna"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {primary.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(path, href) ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 text-[11px]",
                  isActive(path, href) ? "font-bold text-brand dark:text-lime" : "font-medium text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-[30px] w-14 place-items-center rounded-full",
                    isActive(path, href) && "bg-lime-soft dark:bg-lime-soft",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                {label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              className={cn(
                "flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px]",
                moreActive ? "font-bold text-brand dark:text-lime" : "font-medium text-muted-foreground",
              )}
            >
              <span className={cn("grid h-[30px] w-14 place-items-center rounded-full", moreActive && "bg-lime-soft")}>
                <EllipsisIcon className="size-5" />
              </span>
              Więcej
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Więcej</SheetTitle>
          </SheetHeader>
          <ul className="grid grid-cols-3 gap-2 px-4 pb-4">
            {more.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setSheetOpen(false)}
                  aria-current={isActive(path, href) ? "page" : undefined}
                  className={cn(
                    "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border text-xs font-medium",
                    isActive(path, href) ? "border-primary bg-primary/10 text-primary" : "text-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              </li>
            ))}
            {email && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setSheetOpen(false);
                  }}
                  className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl border text-xs font-medium text-muted-foreground"
                >
                  <LogOutIcon className="size-5" />
                  Wyloguj
                </button>
              </li>
            )}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
