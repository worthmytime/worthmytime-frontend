"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/AppProvider";
import { Field } from "@/components/FormField";
import ProfileForm from "@/components/ProfileForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { applyServerErrors, errorMessage } from "@/lib/forms";

const authSchema = z.object({
  email: z.string().trim().email("Podaj poprawny adres e-mail"),
  password: z.string().min(8, "Hasło musi mieć co najmniej 8 znaków").max(128),
});
type AuthForm = z.infer<typeof authSchema>;

export default function ProfilePage() {
  const { ready, loggedIn, email, profile, logout } = useApp();
  if (!ready) return <Skeleton className="mx-auto h-96 max-w-lg" />;

  // przed zalogowaniem ta strona służy tylko do logowania i rejestracji; profil finansowy pokazujemy dopiero na koncie
  if (!loggedIn) {
    return (
      <div className="mx-auto grid max-w-lg gap-6">
        <AuthCard />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-lg gap-6">
      <Card data-testid="profile-card">
        <CardHeader>
          <CardTitle className="text-lg">Profil finansowy</CardTitle>
          <CardDescription>Na jego podstawie przeliczamy ceny na godziny pracy.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* profil z konta dociera chwilę po zalogowaniu, więc formularz odświeża się razem z nim */}
          <ProfileForm key={JSON.stringify(profile)} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <p className="text-muted-foreground">Zalogowano jako</p>
            <p className="truncate font-medium">{email}</p>
          </div>
          <Button variant="outline" className="h-11" onClick={logout}>
            <LogOutIcon /> Wyloguj
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthCard() {
  const { login } = useApp();
  const [register, setRegister] = useState(false);
  const form = useForm<AuthForm>({ resolver: zodResolver(authSchema), defaultValues: { email: "", password: "" } });
  const {
    formState: { errors, isSubmitting },
  } = form;

  async function submit(v: AuthForm) {
    try {
      await login(v.email, v.password, register);
      toast.success(register ? "Konto utworzone" : "Zalogowano");
    } catch (e) {
      if (!applyServerErrors(e, form.setError)) toast.error(errorMessage(e, "Nie udało się zalogować"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{register ? "Załóż konto" : "Zaloguj się"}</CardTitle>
        <CardDescription>
          Konto jest potrzebne tylko do zapisywania historii i udostępniania wyników. Profil finansowy zobaczysz tutaj po zalogowaniu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="grid gap-4">
          <Field label="E-mail" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" className="h-11" {...form.register("email")} />}
          </Field>
          <Field label="Hasło" hint={register ? "Minimum 8 znaków" : undefined} error={errors.password?.message}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                className="h-11"
                {...form.register("password")}
              />
            )}
          </Field>
          <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
            {register ? "Zarejestruj" : "Zaloguj"}
          </Button>
          <Button type="button" variant="link" onClick={() => setRegister(!register)}>
            {register ? "Mam już konto" : "Nie mam konta - zarejestruj się"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
