"""Registre RGPD : quelles tables liées à un compte sont exportées, lesquelles ne le sont pas.

`test_gdpr.py` échoue si une table référençant `User` n'apparaît dans aucun des deux : chaque
nouveau domaine (séances, poids, repas…) doit rejoindre l'export, ou justifier son exclusion.
Dans les deux cas, ses lignes sont supprimées avec le compte (`on_delete=CASCADE`).
"""

EXPORTED_MODELS = {
    "accounts.profile",
    "account.emailaddress",
    "mfa.authenticator",
    "usersessions.usersession",
    "training.workout",  # avec ses exercices de séance et ses séries
    "training.personalrecord",
}

EXCLUDED_FROM_EXPORT = {
    # Auteur des actions d'administration (compte du personnel). Les entrées qui *visent* un
    # membre n'ont pas de clé étrangère vers lui : `delete_account` les purge explicitement.
    "admin.logentry": "journal des actions d'administration, dont l'auteur est le personnel",
}
