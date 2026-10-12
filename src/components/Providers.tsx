"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppProvider from "./AppProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <AppProvider>{children}</AppProvider>
        {/* odsunięte od góry o wysokość paska nawigacji, żeby powiadomienie nie zasłaniało menu */}
        <Toaster position="top-center" richColors offset={72} mobileOffset={72} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
