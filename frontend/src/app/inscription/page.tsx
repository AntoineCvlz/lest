import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { SignupForm } from "@/features/auth/signup-form";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return (
    <AuthPage
      title="Créer un compte"
      intro="Un code de confirmation vous sera envoyé par e‑mail."
      footer={
        <>
          Déjà un compte ? <TextLink href="/connexion">Se connecter</TextLink>
        </>
      }
    >
      <SignupForm />
    </AuthPage>
  );
}
