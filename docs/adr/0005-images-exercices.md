# ADR 0005 — Illustrer les exercices avec les images de wger, normalisées et servies par Lest

- **Statut** : proposé
- **Date** : 2026-10-30
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

Demande produit du 2026-10-30 : une image « parlante » pour chaque exercice, **au même format
partout**, affichée en vignette dans la bibliothèque et le choix d'exercice, en petit pendant la
saisie et en grand sur la fiche. À régler avant le seed de démo, qui choisit ~150 exercices.

Contraintes de CLAUDE.md concernées : dépôt public et rien de sensible dans l'historique ;
**aucun tracker tiers** ; CSP stricte (`img-src 'self' blob: data:`) ; attribution CC-BY-SA
obligatoire (ADR 0004) ; toute dépendance justifiée ; uploads et images traités sans EXIF.

Vérifié le 2026-10-30 :

| Source | Couverture | Format | Licence | Vérification |
| --- | --- | --- | --- | --- |
| wger `/api/v2/exerciseimage/` | 383 images pour **279** des 939 exercices | 270 photos, 100 dessins au trait (dont 83 d'Everkinetic), 13 autres ; PNG 260, JPG 76, WebP 38, GIF 5, autres 4 | CC-BY-SA 4 : 295, CC-BY-SA 3 : 88 ; **104 sans auteur** renseigné | API publique, toutes les pages |
| free-exercise-db | 800+ exercices, 2 photos chacun | JPG homogènes | « Unlicense » annoncée, **origine des photos non documentée** (ni dans le dépôt, ni dans `wrkout/exercises.json` dont il dérive) | README et dépôts GitHub |
| Everkinetic (`everkinetic/data`) | ~80 exercices, déjà repris par wger | Dessins au trait homogènes | CC-BY-SA 4.0 | Dépôt GitHub |
| Banques commerciales (WorkoutLabs, RepDB…) | Larges | Homogènes | Payantes, ou redistribution interdite | Pages de licence |

Aucune source ouverte ne fournit une image homogène pour chaque exercice.

## Options envisagées

1. **Images wger, normalisées par Lest, et pictogrammes maison pour le reste.** Licence sûre et
   déjà gérée (même source, même attribution). On impose le format : même cadre, même taille,
   même fond. Le contenu reste hétérogène (photos et dessins), et 70 % des exercices n'ont pas
   d'image : un pictogramme par catégorie les remplace.
2. **free-exercise-db.** Photos homogènes pour presque tout le catalogue. Mais rien ne prouve
   que leurs auteurs les ont placées dans le domaine public ; dans un dépôt public et une app
   distribuée, c'est un risque de contrefaçon qu'on ne peut pas mesurer. Écarté tant que
   l'origine n'est pas établie.
3. **Illustrations sur mesure** (illustrateur ou banque sous licence payante) pour les ~150
   exercices courants. Seule voie vers une vraie homogénéité de style, mais coût et délai.
   Gardée pour plus tard, l'option 1 servant de base en attendant.
4. **Lien direct vers les images de wger.** Rien à stocker, mais chaque affichage enverrait
   l'IP de l'utilisateur à un tiers (contraire à « aucun tracker tiers »), exigerait d'ouvrir la
   CSP à `wger.de`, et l'app dépendrait de leur disponibilité en salle. Écarté.

## Décision

Option 1 : l'import télécharge les images wger, les **normalise** et les **stocke** chez nous ;
Lest les sert lui-même. Les exercices sans image affichent un pictogramme de leur catégorie.

| Réglage | Valeur |
| --- | --- |
| Format | WebP, **carré 640 × 640**, qualité 80 ; image entière (pas de recadrage destructif) centrée avec une marge, sur un **fond blanc** commun (celui de la plupart des images de wger : le cadre reste uniforme), dans les deux thèmes ; les dessins au trait restent lisibles en mode sombre |
| Version | `FORMAT_VERSION` enregistrée avec chaque image : un changement de rendu refait les images concernées à l'import suivant |
| Curation | `EXCLUDED_IMAGES` : images de wger relues et écartées (sans rapport avec l'exercice), une ligne commentée chacune |
| Nettoyage | Réencodage complet : métadonnées (EXIF, GPS) supprimées ; GIF animé réduit à sa première image ; conversion RGB |
| Image principale | `is_main` de wger, sinon la première ; les autres gardées pour la fiche |
| Stockage | `FileField` (stockage par défaut, `MEDIA_ROOT`, volume Docker `media`) ; nom de fichier = empreinte SHA-256 du WebP produit : contenu immuable, doublons fusionnés |
| Service | `GET /api/v1/exercise-images/{empreinte}.webp`, **public** (le catalogue l'est), `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable` ; le BFF laisse passer ce `Cache-Control` sur ce seul chemin (il impose `no-store` partout ailleurs) |
| Import | Seulement les URL `https` de l'hôte de `WGER_API_URL`, **sans suivi de redirection** (pas de SSRF par une donnée de l'API), 15 Mo maximum (certains PNG de wger dépassent 6 Mo), délai borné, décodeurs limités à PNG, JPEG, GIF et WebP (surface d'attaque réduite), 25 mégapixels maximum vérifiés avant décodage ; toute erreur sur une image la compte en échec sans interrompre l'import ; fichier existant vérifié par son empreinte, réécrit s'il est abîmé ; image déjà importée (même URL source et même date) non retéléchargée |
| Attribution | Par image : licence, auteur (« auteur non renseigné sur wger » sinon), lien vers l'exercice sur wger, mention « image recadrée et convertie » (modification signalée, exigée par CC-BY-SA) |
| Pictogrammes | 8 SVG maison au trait, un par catégorie, dans le style « Fonte calibrée », dans le même cadre carré ; `aria-hidden`, le nom de l'exercice porte le sens |
| Texte alternatif | Vide pour les vignettes (le nom est juste à côté) ; « Illustration de l'exercice {nom} » sur la fiche |

**Dépendance ajoutée : Pillow 13.0.0** (licence MIT-CMU, publiée le 2026-10-16). Bibliothèque
de référence du traitement d'image en Python, roues officielles avec WebP inclus. Elle servira
aussi aux photos de progression (Phase 3 : vérification du format, suppression des EXIF).
Version épinglée dans `uv.lock`.

## Conséquences

- ✅ Licence maîtrisée : même source et même mécanisme d'attribution que le catalogue.
- ✅ Aucune requête vers un tiers à l'affichage ; CSP inchangée (`img-src 'self'`).
- ✅ Format identique partout, mise en cache longue durée sans invalidation (noms immuables).
- ✅ Fonctionnera hors ligne (Phase 5) : images servies par la même origine, mises en cache par
  le service worker.
- ⚠️ Style hétérogène (photos, dessins) et 70 % d'exercices sans image : assumé, suivi par
  l'option 3 pour les exercices courants. Le seed privilégiera des exercices illustrés.
- ⚠️ Stockage de fichiers à prévoir au déploiement (≈ 383 images, quelques dizaines de Mo) :
  stockage objet et CDN, à décider avec la cible de prod. En dev et E2E : volume Docker.
- ⚠️ Django sert les fichiers dans ce premier temps ; acceptable pour quelques centaines de
  petites images en cache immuable, à remplacer par le stockage objet en prod.
- ⚠️ 104 images sans auteur : attribution à « wger » et lien vers la fiche source, en attendant
  une correction en amont.

📋 Actions :

1. PR back : modèle `ExerciseImage`, normalisation (Pillow), import intégré à `import_exercises`,
   route publique des images (liste blanche du test de sécurité de l'API), tests avec images de
   test générées (aucune image réelle dans le dépôt).
2. PR front : composant `ExerciseImage` (vignette, petite, grande), pictogrammes, intégration
   dans la bibliothèque, le choix, la saisie et la fiche ; attribution sur la fiche ; exception
   `Cache-Control` du BFF.
3. Plus tard : illustrations sur mesure des exercices courants (option 3), si le besoin se
   confirme.
