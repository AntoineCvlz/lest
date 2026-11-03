# ADR 0008 — Stocker les photos de progression chiffrées sur un volume privé

- **Statut** : proposé
- **Date** : 2026-11-03
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

La Phase 3 ajoute des photos de progression (face, profil, dos) à l'app `body`. Ce sont les
données les plus sensibles de Lest : un corps, souvent peu vêtu, daté. CLAUDE.md exige pour les
uploads « MIME vérifié, EXIF supprimé (géolocalisation), stockage privé, URL signées », et le
principe produit 5 le chiffrement au repos des champs sensibles (ADR 0002, ADR 0007).

Contraintes déjà en place :
- le navigateur ne parle qu'au BFF Next.js, qui pose le JWT depuis des cookies `HttpOnly`
  (ADR 0001) et relaie la requête vers Django en la lisant entièrement (`arrayBuffer`), **sans
  limite de taille** aujourd'hui ;
- Pillow réencode déjà les images du catalogue (`apps/training/images.py` : formats sur liste
  blanche, 25 Mpx au plus, sans métadonnées) ;
- aucun stockage objet n'existe : volumes Docker seulement, pas encore de déploiement.

Choix produit du 2026-11-03 : « volume privé chiffré » plutôt que stockage objet et URL signées.

## Options envisagées

1. **Stockage objet (MinIO en dev, S3 compatible) et URL signées à courte durée.** Proche d'une
   prod cloud, décharge le serveur du transfert. Mais un service et une dépendance de plus
   (`boto3`), un chiffrement côté serveur géré par le fournisseur, et une URL signée qui
   **donne accès à qui la possède** pendant sa durée (copiée, journalisée par un proxy,
   gardée dans l'historique).
2. **Fichiers chiffrés (Fernet) sur un volume privé, servis par une route authentifiée.** La
   même clé et la même rotation que les autres champs sensibles (ADR 0002) ; chaque lecture
   passe par le JWT et le contrôle du propriétaire ; aucune dépendance. Coût : Django lit,
   déchiffre et sert chaque image (petites, quelques centaines de Ko), et le volume doit être
   sauvegardé avec la base.
3. **Images en base (`bytea` chiffré).** Sauvegarde unique, mais une base gonflée de
   plusieurs Mo par compte et des requêtes lourdes : écarté.

## Décision

**Option 2.** Une photo envoyée est vérifiée, réencodée, chiffrée, puis écrite sous un nom
aléatoire sur un volume dédié, distinct des images publiques du catalogue.

| Étape | Règle |
| --- | --- |
| Envoi | `PUT /api/v1/progress-photos/{id}/?date=…&pose=…` (UUID v4 du client, ADR 0003 : plusieurs photos par jour ; pose `front`, `side`, `back`) ; corps : l'image brute, `Content-Type: image/jpeg|png|webp` (Django ne lit pas le `multipart` d'un `PUT`, et un corps brut se borne à la lecture) |
| Taille | 15 Mo au plus : refusée **par le BFF** (16 Mo pour tout corps, `Content-Length` puis compteur sur le flux) et par la vue Django (413 avant lecture, lecture bornée) |
| Vérification | type annoncé sur liste blanche (415 sinon), puis contenu décodé par Pillow (JPEG, PNG, WebP ; HEIC exclu) : le contenu fait foi ; 60 Mpx au plus (bombe de décompression) |
| Nettoyage | orientation EXIF appliquée, puis **toutes** les métadonnées retirées par le réencodage (GPS, appareil, date) |
| Formats | WebP, deux tailles : vignette 480 px, grande 1600 px (côté long) ; nouvelle image sans `info` hérité (EXIF, XMP, profil ICC) |
| Chiffrement | Fernet (`common.crypto`, ADR 0002) sur les octets ; nom de fichier aléatoire (`uuid4`), sans lien avec l'identifiant exposé |
| Stockage | volume `private-media` (`PRIVATE_MEDIA_ROOT`), jamais servi par un serveur statique ni par le BFF en cache |
| Lecture | `GET /api/v1/progress-photos/{id}/{thumb|large}/` : JWT, propriétaire vérifié (404 sinon, fichier manquant compris), déchiffrement, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` |
| Suppression | ligne et fichiers ; fichiers effacés après validation de la transaction par un récepteur `post_delete` (suppression directe, remplacement, cascade du compte) |
| Plafonds | 500 photos par compte, limite `body_photo_write` de 30 envois par heure et par compte |
| Export RGPD | métadonnées dans le JSON ; images dans une archive ZIP téléchargeable (PR dédiée de la Phase 3) |

### Écart assumé : pas d'URL signées (CLAUDE.md, uploads)

L'image est servie par une route de l'API derrière le BFF : le navigateur l'affiche avec un
simple `<img src="/api/v1/progress-photos/…">`, les cookies `HttpOnly` partent avec la requête
et le BFF pose le JWT. Une URL signée n'apporterait rien ici (pas de stockage tiers à
déléguer) et ajouterait un jeton porteur copiable. Le jour où un stockage objet arrive, l'ADR
sera revu.

## Conséquences

- ✅ Un vol du volume ou d'une sauvegarde ne livre que des octets chiffrés ; une fuite d'URL ne
  donne rien sans session.
- ✅ Aucune métadonnée d'origine ne survit (GPS, modèle d'appareil) : le réencodage est
  systématique, testé avec une image qui porte des EXIF GPS.
- ✅ Le BFF cesse de lire sans limite les corps de requête : protège aussi les autres routes.
- ⚠️ Django sert les images lui-même : acceptable aux volumes visés (quelques photos par
  semaine et par compte, vignettes d'environ 30 Ko). À revoir avec un stockage objet si
  l'usage grandit.
- ⚠️ Le volume `private-media` doit être sauvegardé avec la base, et une rotation de clé devra
  rechiffrer les fichiers (même commande que pour les champs, ADR 0007).
- ⚠️ Fichier écrit mais transaction annulée, ou suppression interrompue : des orphelins sont
  possibles. Une tâche nocturne efface les fichiers sans ligne.
- 📋 PR `feat(body)` : modèle `ProgressPhoto`, traitement d'image, stockage chiffré, routes,
  plafonds, tests (EXIF GPS retiré, type mensonger refusé, bombe refusée, isolation) ; limite
  de taille du BFF ; puis écran Photos (comparaison avant / après).
