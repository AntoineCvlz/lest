"use client";

import { $api, type Schemas } from "@/shared/api/client";

type HealthOut = Schemas["HealthOut"];
type Component = keyof HealthOut["checks"];

const COMPONENT_LABELS: Record<Component, string> = {
  database: "Base de données",
  cache: "Cache",
};

function isHealthReport(value: unknown): value is HealthOut {
  return typeof value === "object" && value !== null && "checks" in value;
}

function describe(isPending: boolean, data: HealthOut | undefined, error: unknown) {
  if (isPending) return { message: "Vérification de l’API…", checks: undefined };
  if (data) return { message: "API opérationnelle", checks: data.checks };
  // 503 : l'API répond mais une dépendance est tombée ; le corps détaille laquelle.
  if (isHealthReport(error)) return { message: "API dégradée", checks: error.checks };
  return { message: "API injoignable", checks: undefined };
}

export function ApiStatus() {
  const { data, error, isPending } = $api.useQuery(
    "get",
    "/api/v1/health/",
    {},
    { retry: false, refetchInterval: 30_000 },
  );
  const { message, checks } = describe(isPending, data, error);

  return (
    <section aria-labelledby="api-status-title">
      <h2 id="api-status-title">État du service</h2>
      <p role="status">{message}</p>
      {checks && (
        <dl>
          {(Object.keys(COMPONENT_LABELS) as Component[]).map((component) => (
            <div key={component}>
              <dt>{COMPONENT_LABELS[component]}</dt>
              <dd>{checks[component] === "ok" ? "Opérationnel" : "Indisponible"}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
