"use client";

import { TextLink } from "../auth/text-link";
import { ProfileForm } from "./profile-form";
import { useProfile } from "./use-profile";

/** Écran de profil : formulaire pré-rempli, ou orientation si le profil n'existe pas encore. */
export function ProfileEditor() {
  const profile = useProfile();

  if (profile.isPending) return <p role="status">Chargement du profil…</p>;
  if (profile.data) return <ProfileForm initial={profile.data} submitLabel="Enregistrer" />;
  const missing = profile.data === null; // 404 : onboarding pas encore fait
  return (
    <div className="flex flex-col gap-4">
      <p role="status">
        {missing
          ? "Votre profil n’est pas encore rempli."
          : "Connectez-vous pour voir votre profil."}
      </p>
      <TextLink href={missing ? "/bienvenue" : "/connexion"}>
        {missing ? "Compléter mon profil" : "Se connecter"}
      </TextLink>
    </div>
  );
}
