# ADR 0009 — Chercher les aliments dans Ciqual en local, scanner les produits avec Open Food Facts

- **Statut** : accepté
- **Date** : 2026-11-03
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

La Phase 3 ajoute le journal alimentaire. CLAUDE.md prévoit « aliments (Open Food Facts +
perso), scan code-barres », et le choix produit du 2026-11-03 était « API en direct + cache
local ». La documentation d'Open Food Facts (OFF), lue le 2026-11-03, le remet en cause :

- recherche : « 10 req/min/IP address for all search queries […] don't use it for a
  search-as-you-type feature, you would be blocked very quickly » ; la recherche plein texte
  n'existe pas dans l'API v2 (le service dédié, search.openfoodfacts.org, est annoncé) ;
- lecture d'un produit : « 15 req/min/IP address », admise en production « as long as 1 API
  call = 1 real scan by a user » ; au-delà, bannissement possible de l'IP ;
- c'est le serveur de Lest qui appelle OFF : **toutes les limites sont partagées par tous les
  comptes** ;
- licence : base sous ODbL (partage à l'identique d'une base dérivée), contenus sous DbCL,
  images sous CC-BY-SA ; mention obligatoire avec lien vers openfoodfacts.org ; User-Agent
  `AppName/Version (contact)` demandé.

Or la saisie d'un repas de prise de masse porte surtout sur des aliments **génériques** (riz
cuit, blanc de poulet, flocons d'avoine, œufs) : c'est le domaine de la table **Ciqual** de
l'Anses. Version 2025 (2025-11-19) : 3 484 aliments, XML et Excel, **Licence Ouverte Etalab
2.0** (réutilisation libre, mention de la source), doi:10.57745/RDMHWY, vérifié par l'API de
l'entrepôt Recherche Data Gouv.

## Options envisagées

1. **Recherche par l'API OFF, avec cache** (choix initial). Couvre les produits de marque,
   mais 10 recherches par minute pour toute l'application, pas de plein texte, et un risque
   de bannissement que la documentation d'OFF signale elle-même.
2. **Import d'un sous-ensemble d'OFF** (produits vendus en France, export quotidien).
   Recherche locale complète, mais des centaines de milliers de produits et plusieurs Go à
   traiter chaque jour, et l'ODbL sur toute la base importée.
3. **Ciqual importée en local pour la recherche, OFF seulement au scan d'un code-barres**,
   plus les aliments perso. Recherche locale, rapide, sans limite ; un appel OFF par scan
   réel, comme OFF le demande.

## Décision

**Option 3** (choix produit du 2026-11-03, après lecture des limites d'OFF).

| Sujet | Règle |
| --- | --- |
| Ciqual | importée par `import_foods` (commande et tâche mensuelle) depuis les fichiers XML de l'entrepôt (identifiants de fichiers épinglés) ; https seulement, une redirection permise vers le stockage de l'INRAE (`*.stockage.inrae.fr`), tailles bornées ; analyse XML sans entités ni DTD |
| Valeurs Ciqual | kcal (constituant 328, règlement UE 1169/2011), protéines (25000), glucides (31000), lipides (40000), fibres (34100), sucres (32000), sel (10004) pour 100 g ; « - » = inconnu, « traces » et « < x » = 0 |
| OFF | API v2, `GET /api/v2/product/{code}?fields=…` ; un appel par scan, jamais pour la recherche ; produit gardé en base (rafraîchi après 30 jours), absence gardée 1 jour |
| Limite OFF | 12 lectures par minute pour toute l'application (sous les 15 d'OFF), compteur partagé en cache ; au-delà, 503 « réessayez dans un instant » plutôt qu'un bannissement |
| Identification | User-Agent `Lest/<version> (<contact>)`, contact en variable d'environnement (`OFF_CONTACT`) |
| Environnements | tests sans réseau (réponses enregistrées, fictives) ; dev et prod sur `world.openfoodfacts.org` (lecture seule, un scan réel = un appel) |
| Recherche | locale, sans accents (`unaccent`), sur les noms Ciqual, les produits déjà scannés et les aliments perso du compte ; 30 résultats au plus, ceux qui commencent par le terme d'abord |
| Aliments perso | propres au compte, invisibles des autres |
| Valeurs | en clair : la composition d'un aliment n'est pas une donnée de santé (le journal, lui, l'est : PR suivante) |
| Mentions | page « Sources et licences » et fiche d'aliment : « Table Ciqual 2025, Anses, Licence Ouverte Etalab 2.0 » ; « Données Open Food Facts, sous licence ODbL » avec lien vers le produit |

### Écart assumé : liste de résultats bornée plutôt que curseur (CLAUDE.md, API)

La recherche sert une liste de suggestions classées par pertinence (le nom commence par le
terme, puis le contient) : 30 résultats au plus, sans pagination. Un curseur sur un classement
calculé n'apporterait rien à la saisie d'un repas.

### Licence des données

- Ciqual (Etalab 2.0) autorise la redistribution : rien n'empêcherait de versionner les
  fichiers, mais ils pèsent 70 Mo ; ils restent téléchargés, et les tests portent sur des
  aliments fictifs, comme pour RepDB.
- Les produits OFF gardés en base forment une base dérivée au sens de l'ODbL : ils restent
  tels qu'OFF les fournit (aucune modification), leur source et leur licence sont affichées,
  et cette part de la base serait fournie sous ODbL sur demande. Rien d'OFF dans le dépôt.

## Conséquences

- ✅ Recherche instantanée, sans dépendance réseau ni risque de bannissement ; prête pour le
  hors-ligne (Phase 5).
- ✅ Un usage d'OFF conforme à ce qu'OFF demande (un appel par scan, User-Agent, mention).
- ⚠️ Les produits de marque ne se trouvent par leur nom qu'une fois scannés par un compte ; sans
  code-barres, on passe par un aliment générique ou un aliment perso. À revoir si
  search.openfoodfacts.org ouvre une API de recherche adaptée.
- ⚠️ 12 scans par minute pour toute l'application : suffisant pour un usage personnel ; au-delà,
  il faudra une instance locale d'OFF (ce que recommande OFF).
- 📋 PR `feat(nutrition)` : app `nutrition`, modèle `Food`, import Ciqual, recherche ; puis
  passerelle OFF (scan) et aliments perso ; puis journal des repas.
