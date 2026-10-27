// Hook PreToolUse : refuse les écritures dans les fichiers .env* (hors .env.example) et tout
// `git push` forcé. Reçoit l'appel d'outil en JSON sur stdin (format Claude Code).
import { basename } from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { tool_name: tool = "", tool_input: input = {} } = JSON.parse(Buffer.concat(chunks).toString() || "{}");

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const ENV_FILE = /^\.env(\..+)?$/i;
const isProtectedEnvFile = (path) => {
  const name = basename(String(path).replaceAll("\\", "/"));
  return ENV_FILE.test(name) && name.toLowerCase() !== ".env.example";
};

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const path = input.file_path ?? input.notebook_path ?? "";
  if (isProtectedEnvFile(path)) {
    deny(`Écriture refusée dans ${basename(path)} : les fichiers .env* sont gérés à la main (seul .env.example est versionné).`);
  }
}

/** Vrai si le segment est une commande `git [options] push …` avec une option ou un refspec forcé. */
function isForcedPush(segment) {
  const tokens = segment.trim().split(/\s+/);
  if (tokens[0] !== "git") return false;
  const push = tokens.indexOf("push");
  // Entre `git` et `push`, seules des options globales sont admises (`-C dir`, `-c k=v`…).
  if (push < 1 || tokens.slice(1, push).some((t, i, all) => !t.startsWith("-") && !all[i - 1]?.startsWith("-"))) {
    return false;
  }
  return tokens.slice(push + 1).some(
    (t) =>
      t === "--force" ||
      t.startsWith("--force-with-lease") ||
      /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t) ||
      /^\+\S/.test(t),
  );
}

if (["Bash", "PowerShell"].includes(tool)) {
  const command = String(input.command ?? "");
  // Chaque segment de commande (séparé par ; & | ou retour ligne) est examiné séparément.
  for (const segment of command.split(/[;&|\n]+/)) {
    if (isForcedPush(segment)) {
      deny("`git push` forcé refusé : l'historique partagé ne se réécrit pas (CLAUDE.md, ruleset de main).");
    }
    if (
      /(>{1,2}|\b(Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|New-Item|tee|cp|mv)\b)/i.test(segment) &&
      segment.split(/[\s'"`=]+/).some((token) => token && isProtectedEnvFile(token))
    ) {
      deny("Écriture shell refusée dans un fichier .env* (seul .env.example est versionné).");
    }
  }
}

process.exit(0);
