## Intention

<!-- Une seule intention par PR. Pourquoi ce changement ? -->

## Contenu

<!-- Fichiers et décisions clés. Lien vers l'ADR si la décision est structurante. -->

## Tests

<!-- Ce qui est couvert (cas limites, permissions) et comment cela a été vérifié. -->

## Captures (UI)

<!-- Mobile et desktop. Supprimer la section si la PR ne touche pas l'interface. -->

## Checklist

- [ ] Moins de 400 lignes hors fichiers générés, une seule intention
- [ ] Tests ajoutés ou mis à jour (TDD pour la logique métier), y compris l'isolation entre utilisateurs
- [ ] `just lint` et `just test` verts en local
- [ ] Client API régénéré (`just typegen`) si l'API change
- [ ] Toute nouvelle dépendance est justifiée (besoin, alternatives, licence, maintenance)
- [ ] UI : captures mobile et desktop, axe sans violation, clavier et lecteur d'écran vérifiés
- [ ] Auth, uploads, permissions ou données de santé : `/security-review` lancé
- [ ] ADR rédigé si la décision est structurante ; `CLAUDE.md` / README à jour
