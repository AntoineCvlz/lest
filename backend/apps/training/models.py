"""Musculation : catalogue d'exercices (importé de RepDB, ADR 0006), séances et séries.

Le catalogue est commun à tous les comptes ; séances et séries sont propres à chacun.
"""

from typing import ClassVar
from uuid import uuid4

from django.conf import settings
from django.db import models


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
    name = models.CharField(max_length=200)
    name_language = models.CharField(max_length=2, choices=NameLanguage)
    category = models.CharField(max_length=20, choices=Category)
    muscles = models.ManyToManyField(Muscle, related_name="primary_exercises", blank=True)
    secondary_muscles = models.ManyToManyField(
        Muscle, related_name="secondary_exercises", blank=True
    )
    equipment = models.ManyToManyField(Equipment, related_name="exercises", blank=True)
    # Attribution (licence RepDB, ADR 0006).
    license = models.CharField(max_length=40)
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


class ProgramExercise(models.Model):
    """Exercice d'une séance type et sa cible (séries x répétitions)."""

    id = models.UUIDField(primary_key=True, editable=False)
    day = models.ForeignKey(ProgramDay, on_delete=models.CASCADE, related_name="exercises")
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="+")
    position = models.PositiveSmallIntegerField()
    target_sets = models.PositiveSmallIntegerField()
    target_reps = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ("position", "id")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(target_sets__gte=1, target_sets__lte=MAX_TARGET_SETS),
                name="training_programexercise_target_sets_range",
            ),
            models.CheckConstraint(
                condition=models.Q(target_reps__gte=1, target_reps__lte=MAX_TARGET_REPS),
                name="training_programexercise_target_reps_range",
            ),
        ]

    def __str__(self) -> str:
        return f"Exercice de programme {self.pk}"


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
    # PROTECT : un exercice utilisé n'est jamais supprimé du catalogue (désactivé, ADR 0004).
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="+")
    position = models.PositiveSmallIntegerField()
    # Cible recopiée du programme au démarrage : modifier le programme ensuite ne réécrit pas
    # l'historique. Vide hors programme.
    target_sets = models.PositiveSmallIntegerField(null=True, blank=True)
    target_reps = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "created_at")
        constraints: ClassVar[list[models.BaseConstraint]] = [
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
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2)
    reps = models.PositiveSmallIntegerField()
    # Effort perçu (1 à 10, par demi-points), facultatif.
    rpe = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    is_warmup = models.BooleanField(default=False)
    # Heure réelle de la série, fournie par le client (hors ligne compris, ADR 0003).
    performed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "performed_at")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(weight_kg__gte=0, weight_kg__lte=MAX_WEIGHT_KG),
                name="training_set_weight_range",
            ),
            models.CheckConstraint(
                condition=models.Q(reps__lte=MAX_REPS), name="training_set_reps_range"
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
    HEAVIEST = "weight", "Charge maximale"
    ESTIMATED_ONE_REP_MAX = "e1rm", "1RM estimé"


class PersonalRecord(models.Model):
    """Un record battu : chaque nouveau meilleur résultat d'un exercice y est historisé."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="personal_records"
    )
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=8, choices=RecordKind)
    value_kg = models.DecimalField(max_digits=7, decimal_places=2)
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
