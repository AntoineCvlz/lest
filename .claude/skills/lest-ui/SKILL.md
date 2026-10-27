---
name: lest-ui
description: Règles et checklist à suivre avant et pendant la création de tout composant ou écran de Lest (tokens « Fonte calibrée », composants existants, accessibilité, CSP, vérification du rendu réel). À utiliser dès qu'une tâche touche à l'interface.
---

# Construire l'interface de Lest

Lis d'abord `docs/design-system.md` (intention, palettes des deux thèmes, typographie, règles).

## 1. Réutiliser avant de créer

Composants existants dans `frontend/src/shared/ui/` (chacun avec test et story) :

| Composant | Usage |
| --- | --- |
| `Button` | Actions. `variant="primary"` : **une seule** action principale par écran (jaune). `size="lg"` (64 px) pour l'action en séance, `block` en bas d'écran. `type="button"` par défaut. |
| `Stepper` | Valeur par pas (±2,5 kg, ±1 rep). `stepUnit` construit le nom accessible des boutons à partir du texte visible. |
| `ChoiceGroup` | Choix unique court (RPE). Boutons radio natifs mis en forme. |

Utilitaires : `formatNumber` (format français) et `stepValue` (pas sans erreur d'arrondi), dans
`frontend/src/shared/lib/number.ts`. Composant propre à un domaine → `src/features/<domaine>/`.

## 2. Styles

- Uniquement les **tokens** via Tailwind : `bg-ground`, `bg-surface`, `bg-surface-raised`,
  `text-ink`, `text-ink-muted`, `border-line`, `border-line-subtle`, `bg-accent`,
  `text-on-accent`, `text-accent-ink`, `text-danger`, `rounded-control`. Jamais de couleur en dur.
- Largeur Archivo : `[font-stretch:125%]` (titres), `[font-stretch:112%]` (valeurs).
- **Aucun attribut `style` en ligne** : rendu côté serveur, il devient `style="…"` dans le HTML,
  refusé par la CSP de prod (pas de `'unsafe-inline'`, le nonce ne couvre pas les attributs).
- Jaune = action principale, sélection active, focus. Jamais décoratif ; en thème clair, jamais
  comme texte (`text-accent-ink`).

## 3. Accessibilité (WCAG 2.2 AA), à prévoir dès la conception

- HTML natif d'abord (`button`, `input`, `fieldset`/`legend`, `output`, `label`), ARIA en dernier recours.
- Cibles ≥ 44 px ; saisie en séance 56–64 px ; action principale en bas, dans la zone du pouce.
- Le **nom accessible contient le texte visible** (WCAG 2.5.3) : bouton « +1 » → « +1 répétition »,
  pas « Une répétition de plus ».
- Toute valeur modifiée par une action est annoncée (`aria-live="polite"` / `<output>`).
- Jamais la couleur seule : l'état sélectionné change aussi de fond et d'état natif (`checked`,
  `aria-pressed`, `aria-current`).
- Mouvement uniquement en réponse à une action, 120–180 ms, coupé par `prefers-reduced-motion`.
- Textes en français, phrases courtes, verbes d'action ; nombres au format français.

## 4. Tests, dans la même PR que le composant

- `*.test.tsx` (Vitest + Testing Library) : requêtes **par rôle et nom accessible**,
  interactions avec `user-event`, **clavier compris**.
- `*.stories.tsx` : une story par état utile (dont désactivé, vide, erreur). Chaque story est un
  test Chromium avec **axe en mode `error`** (`pnpm --dir frontend test:storybook`).
- Dans au moins une story `play` : vérifier que le **rendu réel** est appliqué (couleur calculée,
  taille, police chargée via `document.fonts.load`) : un HTML sans style passe axe.

## 5. Vérifier le rendu réel avant de rendre la main

1. `pnpm --dir frontend build-storybook`, puis servir `frontend/storybook-static` sur le port
   3100 (origine autorisée par Playwright MCP) ; attendre que le serveur réponde.
2. Playwright MCP : largeur 390 px (mobile), `iframe.html?id=<story>&globals=theme:dark`, puis
   `theme:light` ; captures, console sans erreur.
3. Pour une page de l'app : E2E Playwright mobile + desktop, dans les deux thèmes, avec axe.
4. Lire les captures : hiérarchie, alignements, retours à la ligne (pas d'orphelin), contrastes.
