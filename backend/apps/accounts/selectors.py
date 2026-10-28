from .models import Profile, User


def get_profile(user: User) -> Profile | None:
    """Profil de `user`, ou `None` s'il n'a pas fini l'onboarding."""
    return Profile.objects.filter(user=user).first()
