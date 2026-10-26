import { ApiStatus } from "@/features/health/api-status";

export default function HomePage() {
  return (
    <main>
      <h1>Lest</h1>
      <p>Socle technique en place. L’interface arrive en Phase 1.</p>
      <ApiStatus />
    </main>
  );
}
