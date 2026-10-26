// Conventional Commits : `type(portée): sujet`. Vérifié en local (pre-commit, étape
// commit-msg) et en CI sur les titres de PR (squash merge = titre de PR sur main).
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
    // Sujet en minuscules, mais un nom propre en premier mot est permis
    // (« Django 5.2 LTS… », « Next.js 16… ») ; Title Case et MAJUSCULES restent refusés.
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "scope-enum": [
      2,
      "always",
      [
        // Couches techniques
        "backend",
        "frontend",
        "infra",
        "ci",
        "deps",
        "claude",
        // Domaines métier (CLAUDE.md)
        "accounts",
        "training",
        "activities",
        "nutrition",
        "body",
        "gyms",
        "insights",
        "basicfit",
      ],
    ],
  },
};
