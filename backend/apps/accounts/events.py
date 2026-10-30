"""Événements de domaine émis par `accounts`, pour les autres domaines (pas d'import croisé).

`one_rm_formula_changed(sender=Profile, user=User)` : la formule du 1RM estimé a changé ;
`training` recalcule les records du compte.

Émis de façon synchrone, dans la transaction du profil : une erreur du recalcul annule le
changement de formule. Si le recalcul passe un jour en tâche de fond, l'envoyer avec
`transaction.on_commit`, pour ne jamais recalculer avec une formule annulée ensuite.
"""

from django.dispatch import Signal

one_rm_formula_changed = Signal()
