import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function ResetPasswordPage() {
  return (
    <AuthPage
      title="Nouveau mot de passe"
      intro="Si un compte existe avec cette adresse, un code vient d’y être envoyé par e‑mail."
      footer={<TextLink href="/connexion">Revenir à la connexion</TextLink>}
    >
      <ResetPasswordForm />
    </AuthPage>
  );
}
