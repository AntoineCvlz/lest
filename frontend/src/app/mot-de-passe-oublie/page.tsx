import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <AuthPage
      title="Mot de passe oublié"
      intro="Saisissez l’adresse de votre compte : vous recevrez un code pour choisir un nouveau mot de passe."
      footer={<TextLink href="/connexion">Revenir à la connexion</TextLink>}
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
