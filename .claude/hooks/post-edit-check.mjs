// Hook PostToolUse : après l'édition d'un fichier, lance les vérifications de sa couche.
//   backend/**.py         → ruff (fichier) + mypy strict (projet, incrémental)
//   frontend/**.ts(x)/mts → ESLint (fichier) + tsc (projet)
// En cas d'échec : code 2 et rapport sur stderr, que Claude Code renvoie au modèle.
import { spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MAX_REPORT = 4000;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString() || "{}");
const filePath = payload.tool_input?.file_path ?? payload.tool_response?.filePath;
if (!filePath) process.exit(0);

const rel = relative(ROOT, resolve(filePath)).split(sep).join("/");
const quote = (arg) => `"${arg.replaceAll('"', '\\"')}"`;

/** Lance une vérification ; résout `null` si elle passe, sinon son rapport. */
function run(label, cwd, command, args) {
  return new Promise((done) => {
    // shell: true pour les lanceurs .cmd de Windows (uv, pnpm) ; arguments tous quotés.
    const child = spawn([command, ...args.map(quote)].join(" "), {
      cwd,
      shell: true,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", NEXT_TELEMETRY_DISABLED: "1" },
    });
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.on("close", (code) => done(code === 0 ? null : `## ${label}\n${output.trim()}`));
  });
}

// Les vérifications d'une même couche tournent en parallèle (ESLint typé seul ≈ 10 s).
let checks = [];
if (/^backend\/.+\.py$/.test(rel) && !rel.includes("/migrations/")) {
  const backend = resolve(ROOT, "backend");
  const target = rel.slice("backend/".length);
  checks = [
    run("ruff check", backend, "uv", ["run", "--frozen", "ruff", "check", target]),
    run("ruff format", backend, "uv", ["run", "--frozen", "ruff", "format", "--check", target]),
    run("mypy (strict)", backend, "uv", ["run", "--frozen", "mypy", "."]),
  ];
} else if (/^frontend\/.+\.(ts|tsx|mts)$/.test(rel) && !rel.endsWith("schema.d.ts")) {
  const frontend = resolve(ROOT, "frontend");
  const target = rel.slice("frontend/".length);
  // Binaires appelés directement : `pnpm exec` revérifie dépendances et runtime à chaque appel
  // (plusieurs secondes). La CI et pre-commit passent, eux, par les scripts pnpm.
  const bin = (name) => resolve(frontend, "node_modules", ".bin", name);
  checks = [
    run("eslint", frontend, bin("eslint"), ["--max-warnings=0", target]),
    run("tsc", frontend, bin("tsc"), ["--noEmit"]),
  ];
}

const report = (await Promise.all(checks)).filter(Boolean).join("\n\n");
if (report) {
  process.stderr.write(`Vérifications en échec après l'édition de ${rel} :\n\n${report.slice(0, MAX_REPORT)}\n`);
  process.exit(2);
}
process.exit(0);
