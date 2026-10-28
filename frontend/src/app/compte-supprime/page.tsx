import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Compte supprimé" };

export default function AccountDeletedPage() {
  return (
    <AuthPage
      title="Compte supprimé"
      intro="Votre compte et toutes vos données ont été effacés. Un e-mail de confirmation vient de partir."
      footer={<TextLink href="/inscription">Créer un nouveau compte</TextLink>}
    >
      <TextLink href="/">Revenir à l’accueil</TextLink>
    </AuthPage>
  );
}
