"""Écritures du domaine `nutrition` (ADR 0009) : import de la table Ciqual, produits Open Food
Facts gardés au scan, aliments perso (`PUT`/`DELETE` idempotents sous l'UUID du client)."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.services import lock_account
from apps.nutrition import openfoodfacts
from apps.nutrition.ciqual import CiqualFood
from apps.nutrition.models import (
    MAX_ENTRIES_PER_DAY,
    MAX_ENTRY_GRAMS,
    MAX_WATER_ML,
    Food,
    FoodSource,
    JournalEntry,
    Meal,
    WaterIntake,
)

IMPORT_LOCK = "nutrition:ciqual-import"
# Un import complet prend quelques secondes ; l'expiration ne sert que si le processus meurt.
IMPORT_LOCK_SECONDS = 60 * 60


def _too_many(field: str) -> ValidationError:
    return ValidationError({field: ValidationError("Plafond atteint.", code="too_many")})


class ImportRunningError(Exception):
    """Un import de Ciqual est déjà en cours."""


class EmptyTableError(Exception):
    """Ciqual n'a donné aucun aliment exploitable : rien n'est modifié (sinon toute la table
    serait désactivée sur une réponse vide)."""


@contextmanager
def import_lock() -> Iterator[None]:
    """Exécute l'import seul, ou lève `ImportRunningError`. Le verrou n'est rendu que par celui
    qui le détient (jeton), même s'il a expiré entre-temps."""
    token = uuid4().hex
    if not cache.add(IMPORT_LOCK, token, IMPORT_LOCK_SECONDS):
        raise ImportRunningError
    try:
        yield
    finally:
        if cache.get(IMPORT_LOCK) == token:
            cache.delete(IMPORT_LOCK)


@dataclass(frozen=True)
class ImportReport:
    created: int
    updated: int
    deactivated: int


def import_foods(*, foods: list[CiqualFood]) -> ImportReport:
    """Crée ou met à jour les aliments Ciqual (clé : code Ciqual), et désactive ceux qui ont
    quitté la table (ils restent lisibles depuis le journal). Rejouable, en une transaction.

    Lève `EmptyTableError` sans rien modifier si `foods` est vide.
    """
    if not foods:
        raise EmptyTableError
    now = timezone.now()
    with transaction.atomic():
        existing = {
            food.source_code: food for food in Food.objects.filter(source=FoodSource.CIQUAL)
        }
        created: list[Food] = []
        updated: list[Food] = []
        for item in foods:
            food = existing.get(item.code)
            if food is None:
                food = Food(source=FoodSource.CIQUAL, source_code=item.code)
                created.append(food)
            else:
                updated.append(food)
            food.name = item.name
            food.kcal_100g = item.kcal
            food.protein_100g = item.protein
            food.carbs_100g = item.carbs
            food.fat_100g = item.fat
            food.is_active = True
            food.fetched_at = now
        Food.objects.bulk_create(created, batch_size=500)
        Food.objects.bulk_update(
            updated,
            [
                "name",
                "kcal_100g",
                "protein_100g",
                "carbs_100g",
                "fat_100g",
                "is_active",
                "fetched_at",
            ],
            batch_size=500,
        )
        codes = {item.code for item in foods}
        deactivated = (
            Food.objects.filter(source=FoodSource.CIQUAL, is_active=True)
            .exclude(source_code__in=codes)
            .update(is_active=False)
        )
    return ImportReport(created=len(created), updated=len(updated), deactivated=deactivated)


# --- Open Food Facts : un appel par scan, partagé par tous les comptes (ADR 0009) -----------

# Sous les 15 lectures par minute et par IP d'OFF : le serveur de Lest est une seule IP.
OFF_CALLS_PER_MINUTE = 12
# Part de chaque compte (appels réellement faits) : un compte seul ne prive pas les autres.
OFF_CALLS_PER_ACCOUNT_MINUTE = 4
OFF_CALLS_PER_ACCOUNT_DAY = 100
# Panne d'OFF retenue pour un code : pas de nouvel appel à chaque scan pendant ce temps.
OFF_ERROR_SECONDS = 60
# Un produit gardé reste servi tel quel 30 jours ; une absence, 1 jour.
OFF_FRESH = timedelta(days=30)
OFF_MISSING_SECONDS = 24 * 60 * 60


class BarcodeNotFoundError(Exception):
    """Code-barres invalide, ou produit inconnu d'Open Food Facts."""


class BarcodeUnusableError(Exception):
    """Produit connu d'OFF mais sans valeurs exploitables : à saisir en aliment perso."""


class OffBusyError(Exception):
    """Plafond d'appels à OFF atteint, ou OFF injoignable sans copie locale : réessayer."""


class OffQuotaError(Exception):
    """Part d'appels à OFF du compte épuisée (minute ou jour) : réessayer plus tard."""


def _consume(bucket: str, limit: int, timeout: int = 120) -> bool:
    cache.add(bucket, 0, timeout=timeout)
    return cache.incr(bucket) <= limit


def _consume_off_call(owner: User) -> None:
    """Compte un appel réel à OFF : la part du compte (minute, jour) lève `OffQuotaError`, le
    plafond de l'application `OffBusyError`."""
    now = timezone.now()
    minute, day = f"{now:%Y%m%d%H%M}", f"{now:%Y%m%d}"
    if not (
        _consume(f"nutrition:off-calls:{owner.pk}:{minute}", OFF_CALLS_PER_ACCOUNT_MINUTE)
        and _consume(
            f"nutrition:off-calls:{owner.pk}:{day}", OFF_CALLS_PER_ACCOUNT_DAY, timeout=2 * 86400
        )
    ):
        raise OffQuotaError
    if not _consume(f"nutrition:off-calls:{minute}", OFF_CALLS_PER_MINUTE):
        raise OffBusyError


def lookup_barcode(
    *,
    owner: User,
    code: str,
    fetch: Callable[[str], openfoodfacts.OffProduct | None] | None = None,
) -> Food:
    """Aliment du code-barres `code` : copie locale récente, sinon lu chez OFF et gardé.

    Lève `BarcodeNotFoundError`, `BarcodeUnusableError`, `OffQuotaError` ou `OffBusyError`.
    Une copie locale ancienne est servie plutôt qu'une erreur (plafond, panne, produit retiré
    d'OFF). Absence, produit inexploitable et panne sont retenus : pas d'appel à chaque scan.
    """
    if not openfoodfacts.valid_barcode(code):
        raise BarcodeNotFoundError
    known = Food.objects.filter(source=FoodSource.OFF, source_code=code, owner__isnull=True).first()
    now = timezone.now()
    if known is not None and known.fetched_at and now - known.fetched_at < OFF_FRESH:
        return known
    missing_key = f"nutrition:off-missing:{code}"
    unusable_key = f"nutrition:off-unusable:{code}"
    if known is None and cache.get(missing_key):
        raise BarcodeNotFoundError
    error_key = f"nutrition:off-error:{code}"
    if known is None and cache.get(unusable_key):
        raise BarcodeUnusableError
    if cache.get(error_key):
        if known is not None:
            return known
        raise OffBusyError
    try:
        _consume_off_call(owner)
    except (OffQuotaError, OffBusyError):
        if known is not None:
            return known
        raise
    reader = fetch or (
        lambda value: openfoodfacts.fetch_product(
            value, base_url=settings.OFF_BASE_URL, contact=settings.OFF_CONTACT
        )
    )
    try:
        product = reader(code)
    except openfoodfacts.OffError as error:
        cache.set(error_key, 1, OFF_ERROR_SECONDS)
        if known is not None:
            return known
        raise OffBusyError from error
    except openfoodfacts.UnusableProductError as error:
        cache.set(unusable_key, 1, OFF_MISSING_SECONDS)
        raise BarcodeUnusableError from error
    if product is None:
        if known is not None:
            # Retiré d'OFF : la copie reste servie (le journal y renvoie), sans rappel avant 30 j.
            known.fetched_at = now
            known.save(update_fields=["fetched_at", "updated_at"])
            return known
        cache.set(missing_key, 1, OFF_MISSING_SECONDS)
        raise BarcodeNotFoundError
    food = known or Food(source=FoodSource.OFF, source_code=code)
    food.name = product.name
    food.brand = product.brand
    food.kcal_100g = product.kcal
    food.protein_100g = product.protein
    food.carbs_100g = product.carbs
    food.fat_100g = product.fat
    food.serving_g = product.serving_g
    food.is_active = True
    food.fetched_at = now
    try:
        with transaction.atomic():
            food.save()
    except IntegrityError:
        # Deux premiers scans simultanés : l'autre a écrit, on relit sa copie.
        existing = Food.objects.filter(
            source=FoodSource.OFF, source_code=code, owner__isnull=True
        ).first()
        if existing is not None:
            return existing
        cache.set(unusable_key, 1, OFF_MISSING_SECONDS)
        raise BarcodeUnusableError from None
    except DatabaseError:
        # Valeur refusée par la base malgré la validation : pas de nouvel appel à chaque scan.
        cache.set(unusable_key, 1, OFF_MISSING_SECONDS)
        raise BarcodeUnusableError from None
    return food


# --- Aliments perso ------------------------------------------------------------------------

MAX_CUSTOM_FOODS = 500


class NotFoundError(Exception):
    """Identifiant d'un autre compte, ou d'un aliment commun : répondu comme inconnu (404)."""


@dataclass(frozen=True)
class CustomFoodValues:
    name: str
    brand: str
    kcal_100g: Decimal
    protein_100g: Decimal | None
    carbs_100g: Decimal | None
    fat_100g: Decimal | None
    serving_g: Decimal | None


def put_custom_food(*, owner: User, food_id: UUID, values: CustomFoodValues) -> tuple[Food, bool]:
    """Crée ou remplace l'aliment perso `food_id` de `owner` ; renvoie l'aliment et `True` s'il
    est créé. Lève `NotFoundError` (aliment commun ou d'un autre compte) ou `ValidationError`
    (plafond, valeurs hors bornes)."""
    with transaction.atomic():
        # Sérialise les créations du compte : le plafond ne peut pas être dépassé à deux.
        lock_account(owner)
        existing = Food.objects.select_for_update().filter(pk=food_id).first()
        if existing is not None and existing.owner_id != owner.pk:
            raise NotFoundError
        if existing is None and Food.objects.filter(owner=owner).count() >= MAX_CUSTOM_FOODS:
            raise _too_many("food_id")
        food = existing or Food(id=food_id, source=FoodSource.CUSTOM, owner=owner)
        for field, value in vars(values).items():
            setattr(food, field, value)
        # Bornes (contraintes du modèle) vérifiées ici : un 422 plutôt qu'une erreur de base.
        food.full_clean(validate_unique=False)
        food.save(force_insert=existing is None)
    return food, existing is None


def delete_custom_food(*, owner: User, food_id: UUID) -> None:
    """Supprime l'aliment perso `food_id` de `owner` ; sans effet s'il n'existe pas, est commun
    ou appartient à un autre compte (idempotent)."""
    Food.objects.filter(pk=food_id, owner=owner, source=FoodSource.CUSTOM).delete()


# --- Journal des repas et eau (ADR 0010) ----------------------------------------------------

EARLIEST = date(2000, 1, 1)


class UnknownFoodError(Exception):
    """Aliment inconnu ou invisible du compte (aliment perso d'un autre) : 422."""


def _check_day(day: date) -> None:
    # Une horloge déréglée ne doit pas écrire une date absurde : de 2000 à demain au plus tard.
    if not EARLIEST <= day <= timezone.localdate() + timedelta(days=1):
        raise ValidationError({"date": ValidationError("Date hors plage.", code="out_of_range")})


def _food_name(food: Food) -> str:
    return f"{food.name} ({food.brand})" if food.brand else food.name


def put_entry(
    *, owner: User, entry_id: UUID, day: date, meal: str, food_id: UUID, grams: Decimal
) -> tuple[JournalEntry, bool]:
    """Crée ou remplace l'entrée `entry_id` du journal de `owner` ; renvoie l'entrée et `True`
    si elle est créée.

    L'aliment est recopié à la première saisie, et quand il change : modifier la quantité ou le
    repas garde la copie (l'historique ne suit pas les corrections de l'aliment). Lève
    `NotFoundError` (entrée d'un autre compte), `UnknownFoodError` (aliment invisible) ou
    `ValidationError` (date, repas, quantité, plafond du jour).
    """
    _check_day(day)
    if meal not in Meal.values:
        raise ValidationError({"meal": ValidationError("Repas inconnu.", code="invalid_choice")})
    if not Decimal(0) < grams <= MAX_ENTRY_GRAMS:
        raise ValidationError(
            {"grams": ValidationError("Quantité hors plage.", code="out_of_range")}
        )
    with transaction.atomic():
        # Sérialise les saisies du compte : le plafond du jour ne peut pas être dépassé à deux.
        lock_account(owner)
        existing = JournalEntry.objects.select_for_update().filter(pk=entry_id).first()
        if existing is not None and existing.owner_id != owner.pk:
            raise NotFoundError
        if (
            existing is None
            and JournalEntry.objects.filter(owner=owner, date=day).count() >= MAX_ENTRIES_PER_DAY
        ):
            raise ValidationError(
                {"entry_id": ValidationError("Plafond atteint.", code="too_many")}
            )
        entry = existing or JournalEntry(id=entry_id, owner=owner)
        if existing is None or existing.food_ref != str(food_id):
            food = Food.objects.filter(
                Q(owner__isnull=True) | Q(owner=owner), pk=food_id, is_active=True
            ).first()
            if food is None:
                raise UnknownFoodError
            entry.food_ref = str(food.pk)
            entry.name = _food_name(food)
            entry.kcal_100g = food.kcal_100g
            entry.protein_100g = food.protein_100g
            entry.carbs_100g = food.carbs_100g
            entry.fat_100g = food.fat_100g
        entry.date, entry.meal, entry.grams = day, meal, grams
        entry.save(force_insert=existing is None)
    return entry, existing is None


def delete_entry(*, owner: User, entry_id: UUID) -> None:
    """Supprime l'entrée `entry_id` de `owner` ; sans effet si elle n'existe pas ou appartient à
    un autre compte (idempotent)."""
    JournalEntry.objects.filter(owner=owner, pk=entry_id).delete()


def put_water(*, owner: User, day: date, ml: int) -> WaterIntake:
    """Fixe l'eau bue le jour `day` par `owner` (total du jour, idempotent)."""
    _check_day(day)
    if not 0 <= ml <= MAX_WATER_ML:
        raise ValidationError({"ml": ValidationError("Quantité hors plage.", code="out_of_range")})
    with transaction.atomic():
        water, _ = WaterIntake.objects.update_or_create(
            owner=owner, date=day, defaults={"ml": Decimal(ml)}
        )
    return water
