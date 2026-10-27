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

/**
 * Lance une vérification **sans shell** (le chemin du fichier ne peut rien injecter) ;
 * résout `null` si elle passe, sinon son rapport.
 */
function run(label, cwd, executable, args) {
  return new Promise((done) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.on("error", (error) => done(`## ${label}\nImpossible de lancer ${executable} : ${error.message}`));
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
  // Scripts JS lancés avec le Node courant : ni `pnpm exec` (qui revérifie dépendances et
  // runtime à chaque appel, plusieurs secondes), ni lanceurs `.cmd` (qui exigent un shell
  // sous Windows). La CI et pre-commit passent, eux, par les scripts pnpm.
  const script = (...path) => resolve(frontend, "node_modules", ...path);
  checks = [
    run("eslint", frontend, process.execPath, [
      script("eslint", "bin", "eslint.js"),
      "--max-warnings=0",
      target,
    ]),
    run("tsc", frontend, process.execPath, [script("typescript", "bin", "tsc"), "--noEmit"]),
  ];
}

const report = (await Promise.all(checks)).filter(Boolean).join("\n\n");
if (report) {
  process.stderr.write(`Vérifications en échec après l'édition de ${rel} :\n\n${report.slice(0, MAX_REPORT)}\n`);
  process.exit(2);
}
process.exit(0);
