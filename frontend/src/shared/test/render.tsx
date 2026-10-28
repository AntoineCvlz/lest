import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Rendu avec un QueryClient neuf et sans nouvelle tentative, pour des tests déterministes.
 * Le client est renvoyé pour vérifier le cache (données retirées à la déconnexion…).
 */
export function renderWithQuery(ui: ReactElement): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...result, queryClient };
}
