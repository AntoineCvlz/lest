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
    <section
      aria-labelledby="api-status-title"
      className="rounded-control bg-surface-raised flex flex-col gap-3 p-5"
    >
      <h2 id="api-status-title" className="text-ink-muted text-sm font-semibold">
        État du service
      </h2>
      <p role="status" className="text-xl font-bold [font-stretch:112%]">
        {message}
      </p>
      {checks && (
        <dl className="flex flex-col">
          {(Object.keys(COMPONENT_LABELS) as Component[]).map((component) => (
            <div
              key={component}
              className="border-line-subtle flex justify-between gap-4 border-t py-2"
            >
              <dt className="text-ink-muted">{COMPONENT_LABELS[component]}</dt>
              <dd>{checks[component] === "ok" ? "Opérationnel" : "Indisponible"}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
