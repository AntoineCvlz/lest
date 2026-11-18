# Design system — « Magnésie »

- **Statut** : direction choisie le 2026-11-18, parmi trois propositions (A — Magnésie,
  B — Caoutchouc, C — Tableau blanc), pour le recentrage du produit sur un carnet de
  musculation complet. Elle remplace « Fonte calibrée » (2026-10-27). Maquettes : canevas privé
  « Lest — directions visuelles ».
- **Source de vérité des valeurs** : les tokens CSS `--lest-*` de
  `frontend/src/shared/ui/tokens.css`, exposés à Tailwind sous des noms d'usage dans
  `frontend/src/app/globals.css` (`bg-ground`, `text-ink`, `bg-accent`…). Ce document en donne
  l'intention et les règles d'usage.
- **Thème** : sombre par défaut ; clair selon `prefers-color-scheme`, ou forcé par l'attribut
  `data-theme="light|dark"` sur `<html>` (préférence de profil). Un test garantit que les deux
  déclarations du thème clair restent identiques.

## Intention

La poussière de **magnésie** sur une barre, l'ardoise d'une salle peu éclairée : un carnet
d'entraînement **précis et dense**, qui fait instrument de mesure. L'écran de séance montre toutes
les séries d'un exercice en tableau, avec ce qu'on a fait la dernière fois, et se coche d'un pouce.

- **Une carte par exercice**, un tableau serré par carte (Série, Précédent, kg, Reps, coche) :
  on compare d'un coup d'œil, sans changer d'écran.
- **Une seule couleur d'accent**, le cobalt, réservée à l'action principale, à la sélection et au
  focus. La série faite se lit à son fond (`done`) **et** à sa case cochée.
- **La typographie porte le caractère** : Anybody, étroite et lourde, pour les titres et les
  chiffres qui comptent (durée, charge, minuteur) ; Public Sans, sobre, pour tout le reste.

## Couleurs

Contrastes calculés (WCAG) sur le fond de chaque thème, à revérifier par axe à chaque composant.

| Rôle (classe Tailwind / token) | Sombre | Contraste ≈ | Clair | Contraste ≈ |
| --- | --- | --- | --- | --- |
| fond — `ground` | `#1A222C` ardoise | — | `#F3F5F8` | — |
| cartes, champs — `surface` | `#232E3A` | — | `#FFFFFF` | — |
| série en cours, zones — `surface-raised` | `#2D3A48` | — | `#E4E9EF` | — |
| série faite — `done` | `#1F3350` | — | `#DCE8FA` | — |
| texte — `ink` | `#EDF1F5` | 14,1:1 | `#16202B` | 15,1:1 |
| texte secondaire — `ink-muted` | `#A7B3C0` | 7,5:1 (5,4:1 sur `surface-raised`) | `#4E5C6B` | 6,3:1 |
| contour des commandes — `line` | `#7A8DA2` | 4,7:1 (3,4:1 sur `surface-raised`) | `#6C7E90` | 3,8:1 |
| séparateurs (décoratifs) — `line-subtle` | `#3A4A5B` | — | `#C9D2DC` | — |
| **cobalt** — `accent` | `#5B9BFF` | 5,8:1 | `#1F5FC9` | 5,4:1 |
| texte sur l'accent — `on-accent` | `#0B1A2E` | 6,3:1 | `#FFFFFF` | 5,9:1 |
| accent comme texte — `accent-ink` | `#8DB8FF` | 6,8:1 sur `surface` | `#1F5FC9` | 5,9:1 sur `surface` |
| échauffement — `warmup` | `#F2C14E` | — | `#8A5A00` | — |
| erreur — `danger` | `#FF8A7A` | 7,0:1 | `#B3261E` | 6,0:1 |

Règles :

- L'accent n'est **jamais** décoratif : une seule action principale en cobalt par écran.
- `warmup` repère la série d'échauffement, **toujours avec sa lettre « É »** : jamais la couleur
  seule pour porter un sens. De même, une série faite a son fond **et** sa case cochée.
- Les disques du schéma de barre restent en gris acier (tokens `--lest-plate-*` inchangés).

## Typographie

Deux familles variables sous licence OFL, **auto-hébergées** par `next/font` (CSP :
`font-src 'self'`, aucune requête vers un tiers) ; Fontsource dans Storybook.

| Rôle | Police | Utilitaire | Graisse / taille indicatives |
| --- | --- | --- | --- |
| Titre d'écran, nom de séance | Anybody, largeur 72 % | `type-title` | 800, 26–30 |
| Chiffres saillants (durée, charge, minuteur, numéro de série) | Anybody, largeur 82 % | `type-value` | 700–900, 17–52 |
| Texte courant, libellés, tableaux | Public Sans | (défaut) | 400–700, 15–17 |
| Petit texte (aide, en-têtes de colonne) | Public Sans | (défaut) | 400–600, 12–14 (jamais en dessous de 12) |

- Chiffres **tabulaires et alignés** partout (`tabular-nums lining-nums` sur `body`).
- Nombres au format français (`82,5 kg`) par `Intl.NumberFormat('fr-FR')`.
- Pas de majuscules pour les libellés ni les en-têtes de colonne, pas de surtitres.
- Jamais de `font-stretch` écrit à la main : passer par `type-title` / `type-value`.

## Espacements, rayons, ombres, mouvement

- **Espacement** : base 4 px ; échelle 4, 8, 12, 16, 20, 24, 32, 48. Marges latérales d'écran
  mobile : 16 px.
- **Rayons** : 10 px pour les commandes, 14 px pour les cartes d'exercice.
- **Ombres** : aucune en sombre (les surfaces se distinguent par leur valeur) ; une ombre nette
  en clair pour les éléments flottants (feuilles, menus).
- **Mouvement** : 120–180 ms, `ease-out`, uniquement en réponse à une action (série cochée,
  ligne ajoutée). Tout est coupé sous `prefers-reduced-motion: reduce`.

## Ergonomie et accessibilité (rappel des règles de CLAUDE.md appliquées ici)

- Cibles tactiles **≥ 44 × 44 px** ; lignes de série de 48 px au moins ; minuteur et ses
  boutons de 52 px, en bas d'écran, dans la zone du pouce.
- Focus visible : contour de 3 px `--lest-focus` (cobalt), décalé de 2 px.
- Toute valeur qui change suite à une action est annoncée (`aria-live="polite"`).
- Icônes en SVG au trait, `aria-hidden` avec un texte, `aria-label` sur les boutons qui n'ont
  qu'une icône. Jamais d'emoji.

## Composants et Storybook

- Composants de base dans `frontend/src/shared/ui/`, chacun avec son test et sa story.
- `pnpm --dir frontend storybook` (port 6006) : barre d'outils « Thème » (sombre / clair).
- **Chaque story est un test** (`pnpm --dir frontend test:storybook`, et en CI), avec **axe en
  mode `error`** ; les stories clés vérifient que les tokens et Public Sans sont réellement
  appliqués.

## Passage de « Fonte calibrée » à « Magnésie »

Fait dans la PR du 2026-11-18 : tokens, polices, `type-title` / `type-value` à la place des
largeurs Archivo. L'écran de séance en tableau, les cartes d'exercice et le minuteur en bas
d'écran arrivent avec la refonte de la séance (PR suivantes).
