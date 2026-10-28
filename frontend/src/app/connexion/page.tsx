import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { LoginForm } from "@/features/auth/login-form";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <AuthPage
      title="Connexion"
      footer={
        <>
          Pas encore de compte ? <TextLink href="/inscription">Créer un compte</TextLink>
        </>
      }
    >
      <LoginForm />
    </AuthPage>
  );
}
