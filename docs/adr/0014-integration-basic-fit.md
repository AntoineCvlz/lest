# ADR 0014 — Basic-Fit : les données du membre seulement, par un adaptateur isolé et désactivable

- **Statut** : accepté
- **Date** : 2026-11-04
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md prévoit de relier Basic-Fit par le paquet non officiel `basicfit`, derrière un
adaptateur, avec un drapeau `BASICFIT_ENABLED` et un ADR sur les risques. Le dépôt et le paquet
ont été relus le 2026-11-04 (version 1.0.0 du 2026-07-23, seule version publiée, MIT, un
mainteneur, 1 étoile, 1 331 lignes, sans attestation de provenance sur PyPI) :

- le paquet se présente comme l'application Android officielle (User-Agent, en-têtes
  `bfa-version`, `client_id` de l'application) : l'API n'est ni publique ni documentée ;
- la connexion passe par la page de Basic-Fit protégée par un anti-robot : l'utilisateur se
  connecte dans son navigateur, qui aboutit sur `com.basicfit.trainingapp:/oauthredirect?code=…`
  (PKCE S256) ; les jetons de rafraîchissement tournent à chaque appel ;
- entraînements, recettes et fiches de clubs viennent de l'espace Contentful de Basic-Fit, lu
  avec le jeton embarqué dans leur application : contenus de Basic-Fit, sans licence ;
- `parse_redirect` accepte un code collé seul, sans vérifier le `state` ;
- les messages d'erreur reprennent jusqu'à 120 caractères de la réponse du serveur ;
- rien d'exécutable à l'import, aucun `eval`, aucun sous-processus ; réseau limité aux domaines
  Basic-Fit et Contentful ; dépendance : `aiohttp` (Apache-2.0 et MIT).

Choix produit du 2026-11-04 : **les données du membre seulement** (club principal, visites,
pesées de la balance du club, badges), pas de contenus Basic-Fit ; une pesée saisie à la main
prime sur celle de la balance ; **le poids seulement**, sans la composition corporelle.

## Options envisagées

1. **Paquet `basicfit` épinglé par hash, derrière une passerelle unique**, désactivé par défaut,
   synchronisation par Celery. Peu de code, mais une dépendance fragile et sans garantie.
2. **Client maison** reprenant les mêmes appels. Pas de dépendance tierce, mais le même risque
   de casse et de conditions d'utilisation, et du code d'authentification à maintenir seul.
3. **Pas d'intégration**, saisie manuelle et import CSV plus tard. Aucun risque, mais le
   calendrier d'assiduité et les pesées du club demandent une double saisie.

## Décision

**Option 1**, limitée au compte personnel de l'utilisateur.

| Sujet | Règle |
| --- | --- |
| Isolation | app `integrations/basicfit/` ; `BasicFitGateway` est le seul module qui importe `basicfit` (test d'architecture) ; DTO internes ; aucun autre domaine ne connaît le paquet |
| Drapeau | `BASICFIT_ENABLED` (défaut : faux) ; désactivé, les routes répondent 404 et aucune tâche ne s'exécute ; l'application reste entièrement utilisable |
| Connexion | `state` et vérificateur PKCE générés par le serveur, gardés chiffrés 10 minutes pour le compte ; l'URL de redirection **complète** est exigée, `state` comparé en temps constant, usage unique ; l'écran explique le collage de l'URL |
| Jetons | jeu de jetons chiffré (Fernet, ADR 0002) ; la rotation (`token_updated`, dans la boucle asyncio où l'ORM est interdit) est recueillie puis écrite **dès la fin de l'appel**, seule et avant les visites, même en cas d'échec ; jamais par-dessus une connexion plus récente (numéro de génération) ; risque résiduel : un processus tué pendant l'appel perd la rotation (reconnexion) ; jamais journalisés, jamais exportés, jamais renvoyés au navigateur |
| Erreurs | le paquet lève `BasicFitAuthError` pour toute réponse du serveur de jetons autre que 200 (panne comprise) : jetons gardés et nouvel essai, effacés et reconnexion demandée au **troisième** refus consécutif ; `BasicFitAPIError` et réseau : code d'erreur interne seulement, aucun message du serveur journalisé ni affiché |
| Données gardées | nom du club principal, visites (date, club), poids de la balance (jours sans pesée manuelle), badges ; **rien d'autre** du profil membre (nom, carte, numéro d'adhérent, dette ignorés) |
| Synchronisation | tâche Celery chaque heure ; au plus **une tentative** (réussie ou non) par heure et par compte, à la demande comme planifiée ; une seule en file ; verrou par compte plus long que la limite dure d'une tâche ; backoff exponentiel ; `basicfit_sync` 3 demandes par heure |
| Tests | passerelle simulée, réponses enregistrées **fictives** (aucune vraie réponse Basic-Fit dans le dépôt public), aucun appel réseau en CI |
| Dépendances | `basicfit==1.0.0` épinglé par hash (`uv.lock` : archive source `sha256:98a29fbc7d7edac4bfe2ff376d3e838ce52203fe352fb8b14d2e22ce797d83c4`, roue `sha256:164b4d8f60f1c00ad29801d18110313e0a021e1a336c1ca3e02e38ece5c22e83`, identiques au code relu) ; exclu de Dependabot, monté seulement par une PR manuelle après relecture ; un test échoue si ces empreintes changent ; `aiohttp>=3.14.5` déclaré en dépendance directe (la passerelle l'importe) |
| RGPD | état de la connexion et données importées exportés ; jetons exclus de l'export ; tout supprimé avec le compte ou à la déconnexion de Basic-Fit (jetons) |
| Révocation | le paquet n'expose aucune révocation : après une déconnexion, la session reste valable chez Basic-Fit jusqu'à son expiration ; l'écran invite à la fermer depuis l'application Basic-Fit |
| Suivi d'erreurs | toute erreur du paquet devient une erreur à nous, sans son message ; un futur outil de suivi d'erreurs ne capture pas les variables locales de la passerelle (jetons, code, vérificateur) |

## Conséquences

- ✅ Visites et pesées du club sans double saisie, pour qui l'active.
- ✅ Aucun contenu de Basic-Fit réutilisé ; données minimales.
- ⚠️ API non officielle : elle peut casser sans préavis, et son usage peut contrevenir aux
  conditions d'utilisation de Basic-Fit ; l'écran le dit, l'intégration reste désactivable et
  réservée au compte personnel de l'utilisateur.
- ⚠️ Paquet d'un seul mainteneur, sans provenance : version figée, relue, mise à jour à la main.
- ⚠️ Pesées de la balance : une par jour (la plus récente), dans `body` avec la source
  `basicfit` ; elles remplissent les jours vides et suivent leur balance, jamais elles ne
  remplacent une saisie manuelle. Une pesée de la balance supprimée à la main revient à la
  synchronisation suivante si elle date de la semaine relue : la remplacer par une saisie
  manuelle la fige.
- ⚠️ Le collage d'une URL de redirection est inhabituel : l'écran le guide pas à pas, et
  avertit de ne jamais transmettre cette adresse à quelqu'un (elle relierait son compte
  Basic-Fit au compte Lest de cette personne).
- 📋 PR `feat(basicfit)` : (1) cet ADR, dépendances, passerelle, connexion ; (2) synchronisation
  des visites et du club ; (3) pesées de la balance dans `body` (source de la pesée) ;
  (4) écrans.
