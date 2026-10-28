import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { LoginForm } from "@/features/auth/login-form";
import { NEXT_PARAM, safeNext } from "@/features/auth/private-routes";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  // Page où revenir après la connexion : seulement une page privée connue (pas d'open redirect).
  const redirectTo = safeNext((await searchParams)[NEXT_PARAM]);
  return (
    <AuthPage
      title="Connexion"
      footer={
        <>
          Pas encore de compte ? <TextLink href="/inscription">Créer un compte</TextLink>
        </>
      }
    >
      <LoginForm redirectTo={redirectTo} />
    </AuthPage>
  );
}
