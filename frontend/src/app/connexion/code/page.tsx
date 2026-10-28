import type { Metadata } from "next";

import { AuthPage } from "@/features/auth/auth-page";
import { NEXT_PARAM, safeNext } from "@/features/auth/private-routes";
import { TextLink } from "@/features/auth/text-link";
import { SecondFactorForm } from "@/features/security/second-factor-form";

export const metadata: Metadata = { title: "Code de vérification" };

// Type explicite plutôt que `PageProps` (absent sans `next typegen`, voir /connexion).
export default async function SecondFactorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = safeNext((await searchParams)[NEXT_PARAM]);
  return (
    <AuthPage
      title="Code de vérification"
      intro="La double authentification est active sur ce compte."
      footer={<TextLink href="/connexion">Revenir à la connexion</TextLink>}
    >
      <SecondFactorForm redirectTo={redirectTo} />
    </AuthPage>
  );
}
