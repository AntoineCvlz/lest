import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { ProfileForm } from "@/features/profile/profile-form";

export const metadata: Metadata = { title: "Bienvenue" };

export default function OnboardingPage() {
  return (
    <AuthPage
      title="Bienvenue"
      intro="Trois réglages pour adapter Lest à votre entraînement. Vous pourrez les changer dans votre profil."
    >
      <ProfileForm submitLabel="Commencer" redirectTo="/" />
    </AuthPage>
  );
}
