# Design system — « Fonte calibrée »

- **Statut** : direction choisie le 2026-10-27, parmi trois propositions (A — Fonte calibrée,
  B — Carnet, C — Cockpit). Maquettes : canevas privé « Lest — directions visuelles ».
- **Source de vérité des valeurs** : les tokens CSS `--lest-*` de
  `frontend/src/shared/ui/tokens.css`, exposés à Tailwind sous des noms d'usage dans
  `frontend/src/app/globals.css` (`bg-ground`, `text-ink`, `bg-accent`…). Ce document en donne
  l'intention et les règles d'usage.
- **Thème** : sombre par défaut ; clair selon `prefers-color-scheme`, ou forcé par l'attribut
  `data-theme="light|dark"` sur `<html>` (préférence de profil). Un test garantit que les deux
  déclarations du thème clair restent identiques.

## Intention

L'univers des **disques de fonte calibrés** de compétition et de l'acier de la salle : des
chiffres frappés, larges et lourds, sur un fond ardoise. L'interface se lit d'un coup d'œil,
d'une main, entre deux séries, dans une salle souvent mal éclairée.

- **L'élément signature est utile** : le schéma de chargement de la barre (disques par côté,
  recalculés à chaque changement de charge) évite le calcul de tête. Pas de décoration gratuite.
- **Une seule couleur d'accent**, le jaune du disque de 15 kg, réservée à l'action principale
  et à l'état actif. Tout le reste est en gris acier.
- **La typographie porte le caractère** : Archivo en largeur étendue et graisse lourde pour les
  titres et les chiffres ; même famille, largeur normale, pour le texte.

## Couleurs

Thème sombre **par défaut** (salle peu éclairée) ; thème clair complet. Contrastes calculés sur
le fond de chaque thème, à revérifier par axe à chaque composant.

| Rôle (classe Tailwind / token) | Sombre | Contraste ≈ | Clair | Contraste ≈ |
| --- | --- | --- | --- | --- |
| fond — `ground` / `--lest-ground` | `#1B242D` ardoise | — | `#EEF1F4` | — |
| surfaces, champs — `surface` | `#24303B` acier | — | `#FFFFFF` | — |
| zones (schéma de barre) — `surface-raised` | `#222D38` | — | `#E2E7EC` | — |
| texte — `ink` | `#E9EEF2` givre | 13,4:1 | `#1B242D` | 13,6:1 |
| texte secondaire — `ink-muted` | `#9AA8B5` zinc | 6,4:1 | `#4F5D6B` | 5,9:1 |
| contour des commandes — `line` | `#66788A` | 3,4:1 | `#6B7C8C` | 3,6:1 |
| séparateurs (décoratifs) — `line-subtle` | `#2E3B48` | — | `#D3DAE1` | — |
| **jaune disque 15 kg** — `accent` | `#F2C230` | 9,4:1 | `#F2C230` (fond seulement) | — |
| texte sur l'accent — `on-accent` | `#1B242D` | 9,4:1 | `#1B242D` | 9,4:1 |
| accent utilisé comme texte — `accent-ink` | `#F2C230` | 9,4:1 | `#7A5900` ocre | 5,4:1 |
| erreur — `danger` | `#FF8A7A` | 6,5:1 | `#B3261E` | 5,9:1 |

Règles :

- L'accent n'est **jamais** décoratif : bouton d'action principale (« Valider la série »),
  sélection active, focus. Une seule action principale en jaune par écran.
- En thème clair, le jaune reste un **fond** (texte `on-accent` posé dessus) ; comme texte ou
  trait fin, utiliser `accent-ink`.
- Jamais la couleur seule pour porter un sens : un état sélectionné change aussi de fond
  **et** porte `aria-pressed` / `aria-current` ; une erreur a un texte explicite.
- Les disques du schéma de barre sont en **gris acier**, du plus clair (25 kg) au plus foncé
  (1,25 kg), et leur taille suit leur poids ; ils ne portent pas les couleurs IWF (qui
  multiplieraient les accents).

## Typographie

**Archivo** (police variable, axes `wdth` 62–125 et `wght` 100–900, licence OFL), **auto-hébergée**
par `next/font` : la CSP n'autorise que `font-src 'self'`, et aucune requête vers un tiers.

| Rôle | Largeur | Graisse | Taille / interligne |
| --- | --- | --- | --- |
| Titre d'écran (nom de l'exercice) | 125 % | 800 | 30 / 1,05 |
| Valeur principale (charge en cours) | 112 % | 800 | 52 / 1 |
| Valeur secondaire (répétitions) | 112 % | 800 | 40 / 1 |
| Titre de section | 100 % | 600 | 14 / 1,3, couleur `--color-text-muted` |
| Texte courant | 100 % | 400 | 16 / 1,5 |
| Libellé de bouton | 100–112 % | 700–800 | 17–20 |
| Petit texte (aide, unités) | 100 % | 400 | 14 / 1,4 (jamais en dessous de 13) |

- Chiffres **tabulaires et alignés** partout où des nombres se comparent
  (`font-variant-numeric: tabular-nums lining-nums`).
- Nombres au format français : virgule décimale (`82,5 kg`), espace fine avant les unités
  quand l'API `Intl.NumberFormat('fr-FR')` la fournit.
- Pas de majuscules pour les libellés, pas de surtitres en petites capitales.

## Espacements, rayons, ombres, mouvement

- **Espacement** : base 4 px ; échelle 4, 8, 12, 16, 20, 24, 32, 48. Marges latérales d'écran
  mobile : 20 px.
- **Rayons** : 6 px pour les commandes et zones ; les disques du schéma 3 px ; pas de pastilles
  entièrement arrondies.
- **Ombres** : aucune en thème sombre (les surfaces se distinguent par leur valeur) ; une ombre
  unique et nette en thème clair pour les éléments flottants (feuilles, menus).
- **Mouvement** : 120–180 ms, `ease-out`, uniquement en réponse à une action (le disque qui
  apparaît, la série qui s'ajoute). Tout est désactivé sous `prefers-reduced-motion: reduce`.

## Ergonomie et accessibilité (rappel des règles de CLAUDE.md appliquées ici)

- Cibles tactiles **≥ 44 × 44 px** ; boutons de saisie en séance **56–64 px** de haut.
- Action principale **en bas de l'écran**, pleine largeur, dans la zone du pouce.
- Pas de ±2,5 kg pour la charge, ±1 pour les répétitions, RPE par boutons (7 à 9,5 par 0,5).
- Focus visible (style global) : contour de 3 px `--lest-focus` (jaune en sombre, ocre en
  clair), décalé de 2 px.
- Toute valeur qui change suite à une action est annoncée (`aria-live="polite"`).
- Les icônes sont des SVG au trait, `aria-hidden` quand un texte les accompagne,
  `aria-label` sur les boutons qui n'ont qu'une icône. Jamais d'emoji.

## Option non retenue, à rediscuter

De la direction C : afficher la **cible du programme** à côté de la valeur réelle (« cible
82,5 », « 2,5 au-dessus de la cible »). Utile en séance ; à introduire avec les programmes
(Phase 2), sans nouvelle couleur : en texte secondaire.
