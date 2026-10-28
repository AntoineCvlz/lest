import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { TextLink } from "@/features/auth/text-link";
import { VerifyEmailForm } from "@/features/auth/verify-email-form";

export const metadata: Metadata = { title: "Vérifier votre adresse" };

export default function VerifyEmailPage() {
  return (
    <AuthPage
      title="Vérifiez votre adresse"
      intro="Saisissez le code envoyé par e‑mail. Si un compte existait déjà avec cette adresse, l’e‑mail vous l’indique."
      footer={<TextLink href="/connexion">Revenir à la connexion</TextLink>}
    >
      <VerifyEmailForm />
    </AuthPage>
  );
}
