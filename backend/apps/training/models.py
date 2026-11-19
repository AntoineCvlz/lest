"""Musculation : catalogue d'exercices (importé de RepDB, ADR 0006), séances et séries.

Le catalogue est commun à tous les comptes ; séances et séries sont propres à chacun.
"""

from typing import ClassVar
from uuid import uuid4

from django.conf import settings
from django.db import models

from common.fields import EncryptedDecimalField, EncryptedTextField


class Category(models.TextChoices):
    ABS = "abs", "Abdominaux"
    ARMS = "arms", "Bras"
    BACK = "back", "Dos"
    CALVES = "calves", "Mollets"
    CARDIO = "cardio", "Cardio"
    CHEST = "chest", "Pectoraux"
    LEGS = "legs", "Jambes"
    SHOULDERS = "shoulders", "Épaules"
    FULL_BODY = "full_body", "Corps entier"


class ExerciseKind(models.TextChoices):
    """Ce que mesure une série de l'exercice (ADR 0017) : fixe une fois l'exercice utilisé."""

    WEIGHT_REPS = "weight_reps", "Charge et répétitions"
    REPS = "reps", "Répétitions"
    WEIGHTED_REPS = "weighted_reps", "Lest et répétitions"
    ASSISTED_REPS = "assisted_reps", "Assistance et répétitions"
    DURATION = "duration", "Durée"
    DISTANCE_DURATION = "distance_duration", "Distance et durée"
    WEIGHT_DISTANCE = "weight_distance", "Charge et distance"


# Exercices perso d'un compte (ADR 0017).
MAX_CUSTOM_EXERCISES = 300


class NameLanguage(models.TextChoices):
    """Langue du nom affiché : RepDB ne fournit pas de nom français (ADR 0006)."""

    FRENCH = "fr", "Français"
    ENGLISH = "en", "Anglais"


class Muscle(models.Model):
    # Code de RepDB (`latissimus_dorsi`) : clé de l'import ; libellé français à nous.
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=60)
    is_front = models.BooleanField()

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Equipment(models.Model):
    """Équipement : ceux de RepDB, puis les machines de salle ajoutées par Lest (sans code)."""

    code = models.CharField(max_length=60, unique=True, null=True, blank=True)
    name = models.CharField(max_length=60, unique=True)

    class Meta:
        ordering = ("name",)
        verbose_name_plural = "equipment"

    def __str__(self) -> str:
        return self.name


class Exercise(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    # Identifiant stable de RepDB (`bench-press`) : clé de l'import, rejouable sans doublon.
    source_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    # Vide pour le catalogue ; le compte pour un exercice perso, visible de lui seul (ADR 0017).
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="custom_exercises",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=200)
    name_language = models.CharField(max_length=2, choices=NameLanguage)
    category = models.CharField(max_length=20, choices=Category)
    kind = models.CharField(max_length=20, choices=ExerciseKind, default=ExerciseKind.WEIGHT_REPS)
    muscles = models.ManyToManyField(Muscle, related_name="primary_exercises", blank=True)
    secondary_muscles = models.ManyToManyField(
        Muscle, related_name="secondary_exercises", blank=True
    )
    equipment = models.ManyToManyField(Equipment, related_name="exercises", blank=True)
    # Attribution (licence RepDB, ADR 0006) ; vide pour un exercice perso.
    license = models.CharField(max_length=40, blank=True)
    license_author = models.CharField(max_length=200, blank=True)
    # Retiré de RepDB : gardé pour l'historique des séances, masqué de la recherche.
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(name_language__in=NameLanguage.values),
                name="training_exercise_name_language_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(category__in=Category.values),
                name="training_exercise_category_valid",
            ),
            models.CheckConstraint(
                condition=~models.Q(name=""), name="training_exercise_name_not_empty"
            ),
            models.CheckConstraint(
                condition=models.Q(kind__in=ExerciseKind.values),
                name="training_exercise_kind_valid",
            ),
            # Un exercice perso ne vient d'aucun jeu de données.
            models.CheckConstraint(
                condition=models.Q(owner__isnull=True) | models.Q(source_id__isnull=True),
                name="training_exercise_custom_has_no_source",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class Pose(models.TextChoices):
    """Position illustrée : départ et effort (le mouvement), ou position unique (étirement)."""

    START = "start", "Départ"
    PEAK = "peak", "Effort"
    MAIN = "main", "Position"


class ExerciseImage(models.Model):
    """Image d'un exercice, importée de RepDB et réencodée (ADR 0006) : WebP servi par Lest
    sous le nom de son empreinte. Licence et auteur gardés pour l'attribution."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE, related_name="images")
    pose = models.CharField(max_length=5, choices=Pose)
    # Ordre d'affichage : départ, effort, position unique.
    position = models.PositiveSmallIntegerField()
    # Clé de retéléchargement : une image connue (même chemin source) n'est pas reprise.
    source_url = models.URLField(max_length=500)
    file = models.FileField(upload_to="exercises/")
    # SHA-256 du fichier : nom immuable (cache long) ; deux images identiques le partagent.
    digest = models.CharField(max_length=64, db_index=True)
    # Version du rendu (`images.FORMAT_VERSION`) qui a produit le fichier.
    format_version = models.PositiveSmallIntegerField()
    license = models.CharField(max_length=40)
    license_author = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(
                fields=("exercise", "pose"), name="training_exerciseimage_one_per_pose"
            ),
            models.CheckConstraint(
                condition=models.Q(pose__in=Pose.values), name="training_exerciseimage_pose"
            ),
            models.CheckConstraint(
                condition=models.Q(digest__regex=r"^[0-9a-f]{64}$"),
                name="training_exerciseimage_digest_sha256",
            ),
        ]

    def __str__(self) -> str:
        return f"Image {self.digest[:12]}"


# --- Séances (propres à chaque compte) ------------------------------------------------------
# Identifiants générés par le client et écritures par `PUT` (ADR 0003) : `id` n'a pas de
# valeur par défaut, le client la fournit toujours. Charges en kilogrammes (unités SI).

MAX_WEIGHT_KG = 1000
MAX_REPS = 1000
# Détails d'une séance et de ses exercices (ADR 0017).
MAX_WORKOUT_NAME = 80
MAX_NOTE_LENGTH = 1000
MIN_REST_SECONDS, MAX_REST_SECONDS = 15, 600
MAX_SUPERSET = 50
MIN_HEART_RATE, MAX_HEART_RATE = 30, 230
MIN_FEELING, MAX_FEELING = 1, 5

# Série de durée ou de distance (ADR 0017) : 24 h, 1 000 km.
MAX_DURATION_S = 24 * 60 * 60
MAX_DISTANCE_M = 1_000_000


# Cibles d'un exercice de programme : séries x répétitions.
MAX_TARGET_SETS = 20
MAX_TARGET_REPS = 100


class Program(models.Model):
    """Programme de `owner` : quelques séances types (« Poussée », « Tirage »…). Identifiants
    du client et écritures par `PUT`, comme les séances (ADR 0003)."""

    id = models.UUIDField(primary_key=True, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="programs"
    )
    name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name", "created_at")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=~models.Q(name=""), name="training_program_name_not_empty"
            ),
        ]

    def __str__(self) -> str:
        return f"Programme {self.pk}"


class ProgramDay(models.Model):
    """Séance type d'un programme, à sa place dans le programme."""

    id = models.UUIDField(primary_key=True, editable=False)
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="days")
    name = models.CharField(max_length=80)
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ("position", "id")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=~models.Q(name=""), name="training_programday_name_not_empty"
            ),
        ]

    def __str__(self) -> str:
        return f"Séance type {self.pk}"


class SetType(models.TextChoices):
    """Rôle d'une série (ADR 0017) ; l'échauffement ne compte ni au volume ni aux records."""

    WARMUP = "warmup", "Échauffement"
    NORMAL = "normal", "Normale"
    DROP = "drop", "Dégressive"
    FAILURE = "failure", "À l'échec"


class ProgramExercise(models.Model):
    """Exercice d'une séance type (routine, ADR 0017) : ses séries prévues, son repos, son
    superset et sa note."""

    id = models.UUIDField(primary_key=True, editable=False)
    day = models.ForeignKey(ProgramDay, on_delete=models.CASCADE, related_name="exercises")
    # RESTRICT : jamais supprimé tant qu'il sert, sauf avec le compte (exercice perso, cascade).
    exercise = models.ForeignKey(Exercise, on_delete=models.RESTRICT, related_name="+")
    position = models.PositiveSmallIntegerField()
    rest_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    superset = models.PositiveSmallIntegerField(null=True, blank=True)
    note = EncryptedTextField(null=True, blank=True)

    class Meta:
        ordering = ("position", "id")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(rest_seconds__isnull=True)
                | models.Q(rest_seconds__gte=MIN_REST_SECONDS, rest_seconds__lte=MAX_REST_SECONDS),
                name="training_programexercise_rest_range",
            ),
            models.CheckConstraint(
                condition=models.Q(superset__isnull=True)
                | models.Q(superset__gte=1, superset__lte=MAX_SUPERSET),
                name="training_programexercise_superset_range",
            ),
        ]

    def __str__(self) -> str:
        return f"Exercice de programme {self.pk}"


class ProgramSet(models.Model):
    """Série prévue d'un exercice de routine (ADR 0017) : les colonnes du type de l'exercice,
    toutes facultatives (une charge à trouver, des répétitions visées…)."""

    id = models.UUIDField(primary_key=True, editable=False)
    program_exercise = models.ForeignKey(
        ProgramExercise, on_delete=models.CASCADE, related_name="sets"
    )
    position = models.PositiveSmallIntegerField()
    set_type = models.CharField(max_length=8, choices=SetType, default=SetType.NORMAL)
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_s = models.PositiveIntegerField(null=True, blank=True)
    distance_m = models.DecimalField(max_digits=8, decimal_places=1, null=True, blank=True)

    class Meta:
        ordering = ("position", "id")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(set_type__in=SetType.values),
                name="training_programset_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(weight_kg__isnull=True)
                | models.Q(weight_kg__gte=0, weight_kg__lte=MAX_WEIGHT_KG),
                name="training_programset_weight_range",
            ),
            models.CheckConstraint(
                condition=models.Q(reps__isnull=True) | models.Q(reps__lte=MAX_REPS),
                name="training_programset_reps_range",
            ),
            models.CheckConstraint(
                condition=models.Q(duration_s__isnull=True)
                | models.Q(duration_s__lte=MAX_DURATION_S),
                name="training_programset_duration_range",
            ),
            models.CheckConstraint(
                condition=models.Q(distance_m__isnull=True)
                | models.Q(distance_m__gte=0, distance_m__lte=MAX_DISTANCE_M),
                name="training_programset_distance_range",
            ),
        ]

    def __str__(self) -> str:
        return f"Série prévue {self.pk}"


class Workout(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workouts"
    )
    # Séance type suivie, le cas échéant. Un programme supprimé laisse la séance intacte.
    program_day = models.ForeignKey(
        ProgramDay, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    # Nom affiché (celui de la séance type, ou choisi) ; vide : « Séance » à l'écran.
    name = models.CharField(max_length=MAX_WORKOUT_NAME, blank=True, default="")
    # Texte libre et ressenti : données de santé possibles, chiffrées (ADR 0007, 0017).
    note = EncryptedTextField(null=True, blank=True)
    avg_heart_rate = EncryptedDecimalField(decimal_places=0, null=True, blank=True)
    feeling = EncryptedDecimalField(decimal_places=0, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-started_at",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(ended_at__isnull=True)
                | models.Q(ended_at__gte=models.F("started_at")),
                name="training_workout_ends_after_start",
            ),
        ]

    # Identifiant seul : ni dates ni charges dans les journaux et l'admin (minimisation).
    def __str__(self) -> str:
        return f"Séance {self.pk}"


class WorkoutExercise(models.Model):
    """Exercice d'une séance, à sa place dans l'ordre de la séance."""

    id = models.UUIDField(primary_key=True, editable=False)
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name="exercises")
    # RESTRICT : jamais supprimé tant qu'il sert, sauf avec le compte (exercice perso, cascade).
    exercise = models.ForeignKey(Exercise, on_delete=models.RESTRICT, related_name="+")
    position = models.PositiveSmallIntegerField()
    # Cible recopiée du programme au démarrage : modifier le programme ensuite ne réécrit pas
    # l'historique. Vide hors programme.
    target_sets = models.PositiveSmallIntegerField(null=True, blank=True)
    target_reps = models.PositiveSmallIntegerField(null=True, blank=True)
    # Séries prévues de la routine, recopiées au démarrage (ADR 0017) : l'écran les propose,
    # elles deviennent des séries une fois faites. Liste de dictionnaires (`set_type`,
    # `weight_kg`, `reps`, `duration_s`, `distance_m`), figée comme les cibles.
    planned_sets = models.JSONField(default=list, blank=True)
    # Repos après chaque série ; vide : réglage du profil (ADR 0017).
    rest_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    # Exercices consécutifs de même numéro : un superset (enchaînés sans repos entre eux).
    superset = models.PositiveSmallIntegerField(null=True, blank=True)
    note = EncryptedTextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "created_at")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(rest_seconds__isnull=True)
                | models.Q(rest_seconds__gte=MIN_REST_SECONDS, rest_seconds__lte=MAX_REST_SECONDS),
                name="training_workoutexercise_rest_range",
            ),
            models.CheckConstraint(
                condition=models.Q(superset__isnull=True)
                | models.Q(superset__gte=1, superset__lte=MAX_SUPERSET),
                name="training_workoutexercise_superset_range",
            ),
            models.CheckConstraint(
                condition=models.Q(target_sets__isnull=True, target_reps__isnull=True)
                | models.Q(target_sets__isnull=False, target_reps__isnull=False),
                name="training_workoutexercise_target_complete",
            ),
        ]

    def __str__(self) -> str:
        return f"Exercice de séance {self.pk}"


class Set(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    workout_exercise = models.ForeignKey(
        WorkoutExercise, on_delete=models.CASCADE, related_name="sets"
    )
    position = models.PositiveSmallIntegerField()
    # Colonnes du type de l'exercice seulement, les autres vides (ADR 0017, vérifié par le
    # service). Charge, lest ou assistance selon le type ; durée en secondes, distance en mètres.
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_s = models.PositiveIntegerField(null=True, blank=True)
    distance_m = models.DecimalField(max_digits=8, decimal_places=1, null=True, blank=True)
    # Effort perçu (1 à 10, par demi-points), facultatif.
    rpe = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    set_type = models.CharField(max_length=8, choices=SetType, default=SetType.NORMAL)
    # Heure réelle de la série, fournie par le client (hors ligne compris, ADR 0003).
    performed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "performed_at")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(weight_kg__isnull=True)
                | models.Q(weight_kg__gte=0, weight_kg__lte=MAX_WEIGHT_KG),
                name="training_set_weight_range",
            ),
            models.CheckConstraint(
                condition=models.Q(reps__isnull=True) | models.Q(reps__lte=MAX_REPS),
                name="training_set_reps_range",
            ),
            models.CheckConstraint(
                condition=models.Q(duration_s__isnull=True)
                | models.Q(duration_s__lte=MAX_DURATION_S),
                name="training_set_duration_range",
            ),
            models.CheckConstraint(
                condition=models.Q(distance_m__isnull=True)
                | models.Q(distance_m__gte=0, distance_m__lte=MAX_DISTANCE_M),
                name="training_set_distance_range",
            ),
            # Une série mesure toujours quelque chose.
            models.CheckConstraint(
                condition=models.Q(reps__isnull=False)
                | models.Q(duration_s__isnull=False)
                | models.Q(distance_m__isnull=False),
                name="training_set_measured",
            ),
            models.CheckConstraint(
                condition=models.Q(set_type__in=SetType.values),
                name="training_set_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(rpe__isnull=True) | models.Q(rpe__gte=1, rpe__lte=10),
                name="training_set_rpe_range",
            ),
        ]

    def __str__(self) -> str:
        return f"Série {self.pk}"


# --- Records (dérivés des séries, recalculés à chaque écriture, ADR 0003) -----------------


class RecordKind(models.TextChoices):
    """Unité de `PersonalRecord.value` : kg (charge, 1RM, volume d'une série), répétitions,
    secondes ou mètres."""

    HEAVIEST = "weight", "Charge maximale"
    ESTIMATED_ONE_REP_MAX = "e1rm", "1RM estimé"
    SET_VOLUME = "volume", "Volume d'une série"
    MOST_REPS = "reps", "Répétitions maximales"
    LONGEST_DURATION = "duration", "Durée la plus longue"
    LONGEST_DISTANCE = "distance", "Distance la plus longue"


class PersonalRecord(models.Model):
    """Un record battu : chaque nouveau meilleur résultat d'un exercice y est historisé."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="personal_records"
    )
    # RESTRICT : jamais supprimé tant qu'il sert, sauf avec le compte (exercice perso, cascade).
    exercise = models.ForeignKey(Exercise, on_delete=models.RESTRICT, related_name="+")
    kind = models.CharField(max_length=8, choices=RecordKind)
    value = models.DecimalField(max_digits=12, decimal_places=2)
    # Série qui l'a établi ; supprimée, les records de l'exercice sont recalculés.
    set = models.ForeignKey(Set, on_delete=models.CASCADE, related_name="records")
    achieved_at = models.DateTimeField()

    class Meta:
        ordering = ("achieved_at", "kind")
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=("owner", "exercise", "kind"), name="training_record_lookup"),
        ]
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(kind__in=RecordKind.values), name="training_record_kind_valid"
            ),
            models.UniqueConstraint(fields=("set", "kind"), name="training_record_one_per_set"),
        ]

    def __str__(self) -> str:
        return f"Record {self.pk}"
