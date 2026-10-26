import "@testing-library/jest-dom/vitest";

import { server } from "@/shared/test/msw-server";

// Toute requête non simulée fait échouer le test : aucun appel réseau réel.
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
