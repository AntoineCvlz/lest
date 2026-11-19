"""Texte saisi par l'utilisateur : validateurs partagés par les schémas des API."""


def note_text(text: str) -> str:
    """Note libre sur plusieurs lignes : retours à la ligne et tabulations admis, aucun autre
    caractère de contrôle (NUL compris, voir `printable`)."""
    if any((ord(char) < 0x20 and char not in "\n\t") or ord(char) == 0x7F for char in text):
        msg = "Caractère non autorisé."
        raise ValueError(msg)
    return text


def printable(text: str) -> str:
    """Refuse les caractères de contrôle (dont NUL, refusé par Postgres : sinon une erreur 500
    à volonté) : jamais dans un nom affiché ni dans une recherche."""
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in text):
        msg = "Caractère non autorisé."
        raise ValueError(msg)
    return text
