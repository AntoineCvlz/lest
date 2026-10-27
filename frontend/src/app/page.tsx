import { ApiStatus } from "@/features/health/api-status";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-[40px] leading-none font-extrabold [font-stretch:125%]">Lest</h1>
        <p className="text-ink-muted">
          Socle technique en place. L’interface arrive en Phase&nbsp;1.
        </p>
      </header>
      <ApiStatus />
    </main>
  );
}
