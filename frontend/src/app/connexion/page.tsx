import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 pt-8 pb-6 sm:min-h-0 sm:pt-16">
      <p className="text-2xl font-extrabold [font-stretch:125%]" aria-hidden="true">
        Lest
      </p>
      <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">Connexion</h1>
      <LoginForm />
    </main>
  );
}
