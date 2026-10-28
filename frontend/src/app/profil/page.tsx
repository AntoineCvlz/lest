import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { TextLink } from "@/features/auth/text-link";
import { ProfileEditor } from "@/features/profile/profile-editor";

export const metadata: Metadata = { title: "Profil" };

export default function ProfilePage() {
  return (
    <AuthPage title="Profil" footer={<TextLink href="/">Revenir à l’accueil</TextLink>}>
      <ProfileEditor />
    </AuthPage>
  );
}
