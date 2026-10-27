import { SessionPanel } from "@/features/auth/session-panel";
import { ApiStatus } from "@/features/health/api-status";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-[40px] leading-none font-extrabold [font-stretch:125%]">Lest</h1>
        <p className="text-ink-muted">Comptes en place. Les séances arrivent en Phase&nbsp;2.</p>
      </header>
      <SessionPanel />
      <ApiStatus />
    </main>
  );
}
