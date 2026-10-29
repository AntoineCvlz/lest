import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

import { server } from "@/shared/test/msw-server";

// Attente des assertions asynchrones (`waitFor`, `findBy*`) : 3 s au lieu d'1. La suite tourne
// en parallèle ; sur une machine chargée, une réponse simulée peut dépasser la seconde.
configure({ asyncUtilTimeout: 3000 });

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
