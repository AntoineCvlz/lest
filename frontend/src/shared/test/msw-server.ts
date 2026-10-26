import { setupServer } from "msw/node";

/** Serveur MSW partagé : chaque test déclare ses réponses avec `server.use(...)`. */
export const server = setupServer();
