"""Catalogue des sports (ADR 0012) : fixe, versionné avec le code. Chaque sport dit s'il a une
distance et quelles métriques il accepte ; le serveur valide, le front construit son formulaire
depuis `GET /api/v1/sports/`. Clés stables : elles sont stockées avec chaque activité."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Metric:
    """Métrique entière bornée propre à un sport."""

    key: str
    label: str
    unit: str
    minimum: int
    maximum: int


@dataclass(frozen=True)
class Sport:
    key: str
    label: str
    has_distance: bool
    metrics: tuple[Metric, ...] = ()

    def metric(self, key: str) -> Metric | None:
        return next((m for m in self.metrics if m.key == key), None)


ELEVATION = Metric("elevation_gain_m", "Dénivelé positif", "m", 0, 10_000)

SPORTS: dict[str, Sport] = {
    sport.key: sport
    for sport in (
        Sport("running", "Course à pied", has_distance=True, metrics=(ELEVATION,)),
        Sport("cycling", "Vélo", has_distance=True, metrics=(ELEVATION,)),
        Sport(
            "swimming",
            "Natation",
            has_distance=True,
            metrics=(
                Metric("pool_length_m", "Longueur du bassin", "m", 10, 100),
                Metric("laps", "Longueurs", "", 1, 1_000),
            ),
        ),
        Sport("walking", "Marche", has_distance=True),
        Sport("hiking", "Randonnée", has_distance=True, metrics=(ELEVATION,)),
        Sport("rowing", "Aviron ou rameur", has_distance=True),
        Sport("cardio", "Cardio sur machine", has_distance=True),
        Sport("team_sport", "Sport collectif", has_distance=False),
        Sport("racket", "Sport de raquette", has_distance=False),
        Sport(
            "combat",
            "Sport de combat",
            has_distance=False,
            metrics=(Metric("rounds", "Rounds", "", 1, 100),),
        ),
        Sport(
            "climbing",
            "Escalade",
            has_distance=False,
            metrics=(Metric("routes", "Voies", "", 1, 200),),
        ),
        Sport("yoga", "Yoga ou mobilité", has_distance=False),
        Sport("other", "Autre", has_distance=True),
    )
}
