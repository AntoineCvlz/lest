---
name: adr
description: Rédige un Architecture Decision Record (ADR) au format de Lest dans docs/adr/. À utiliser pour toute décision structurante (choix de bibliothèque, d'architecture, de sécurité, écart à CLAUDE.md) avant de l'implémenter.
---

# Rédiger un ADR Lest

Un ADR fige **une** décision structurante : pourquoi elle est prise maintenant, ce qui a été
écarté et ce qu'elle coûte. Il est relu en PR avant l'implémentation.

## Étapes

1. **Numéro** : prends le suivant dans `docs/adr/` (`NNNN-titre-court.md`, 4 chiffres,
   titre en kebab-case français). `0000-template.md` est le gabarit : suis-le à la lettre.
2. **Vérifie les faits avant d'écrire.** Versions, dépendances et fonctionnalités d'une
   bibliothèque se vérifient (PyPI/npm, code source, notes de version) et ne se citent pas de
   mémoire. Mentionne ce qui a été vérifié et comment.
3. **Contexte** : contraintes de `CLAUDE.md` concernées (cite-les), problème concret, pourquoi
   maintenant.
4. **Options** : au moins deux options **réalistes**, chacune avec avantages et inconvénients
   honnêtes. L'option « ne rien faire » ou « solution maison » est souvent la bonne
   comparaison.
5. **Décision** : une ou deux phrases, puis les réglages concrets (tableau si utile).
6. **Écarts à CLAUDE.md** : s'il y en a, une section dédiée « Écart assumé » qui l'explique ;
   puis mets à jour `CLAUDE.md` dans la même PR.
7. **Conséquences** : bénéfices (✅), coûts et risques avec leur suivi (⚠️), et la liste des
   actions concrètes qui en découlent (📋 PR, réglages, tests).
8. Ajoute le lien dans la liste des ADR du `README.md`.

## Style

- Français, phrases courtes, ton factuel ; pas de marketing.
- Statut initial : `proposé`. Il passe à `accepté` quand la PR est fusionnée.
- Un ADR remplacé n'est jamais supprimé : statut `remplacé par ADR NNNN`.
- Commit : `docs: ADR NNNN on <sujet>` (commitlint).
