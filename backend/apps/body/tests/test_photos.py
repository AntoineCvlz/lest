"""Photos de progression (ADR 0008) : métadonnées retirées, contenu vérifié, fichiers chiffrés,
effacés avec leur ligne, isolés par compte."""

import io
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from django.test import Client, override_settings
from PIL import ExifTags, Image

from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.body import photos, services
from apps.body.models import ProgressPhoto
from apps.body.tasks import ORPHAN_AGE_SECONDS, clear_orphan_photos

pytestmark = pytest.mark.django_db

API = "/api/v1/progress-photos"
QUERY = "?date=2026-10-01&pose=front"
OnCommit = Callable[..., Any]


@pytest.fixture(autouse=True)
def private_media(tmp_path: Path, settings: Any) -> Path:
    settings.PRIVATE_MEDIA_ROOT = str(tmp_path)
    return tmp_path


def jpeg(width: int = 300, height: int = 200, *, orientation: int | None = None) -> bytes:
    """JPEG avec métadonnées : EXIF (appareil, GPS, orientation), XMP et profil ICC."""
    image = Image.new("RGB", (width, height), (200, 30, 30))
    # Repère : moitié gauche bleue, pour vérifier la rotation appliquée.
    image.paste((30, 30, 200), (0, 0, width // 2, height))
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "Appareil-Temoin"
    exif[ExifTags.IFD.GPSInfo] = {
        ExifTags.GPS.GPSLatitudeRef: "N",
        ExifTags.GPS.GPSLatitude: (48.0, 51.0, 24.0),
    }
    if orientation is not None:
        exif[ExifTags.Base.Orientation] = orientation
    out = io.BytesIO()
    image.save(
        out,
        format="JPEG",
        exif=exif.tobytes(),
        xmp=b"<x:xmpmeta xmlns:x='adobe:ns:meta/'>Temoin-XMP</x:xmpmeta>",
        icc_profile=b"Temoin-ICC" * 20,
    )
    return out.getvalue()


class Athlete:
    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def put(
        self, photo_id: object, data: bytes, *, query: str = QUERY, kind: str = "image/jpeg"
    ) -> Any:
        return self.client.put(
            f"{API}/{photo_id}/{query}", data=data, content_type=kind, headers=self.headers
        )

    def get(self, path: str = "") -> Any:
        return self.client.get(f"{API}/{path}", headers=self.headers)

    def delete(self, photo_id: object) -> Any:
        return self.client.delete(f"{API}/{photo_id}/", headers=self.headers)


def files(root: Path) -> list[str]:
    return sorted(path.name for path in root.iterdir())


def test_an_upload_is_cleaned_encrypted_and_served_back(private_media: Path) -> None:
    me = Athlete()
    photo_id = uuid4()

    created = me.put(photo_id, jpeg(orientation=6))

    assert created.status_code == 201
    assert created.json() == {"id": str(photo_id), "date": "2026-10-01", "pose": "front"}
    stored = files(private_media)
    assert len(stored) == 2
    raw = (private_media / stored[0]).read_bytes()
    assert not raw.startswith(b"RIFF")
    assert b"Appareil-Temoin" not in raw

    image = me.get(f"{photo_id}/large/")
    assert image.status_code == 200
    assert image["Content-Type"] == "image/webp"
    assert image["Cache-Control"] == "private, no-store"
    served = Image.open(io.BytesIO(image.content))
    assert served.format == "WEBP"
    # Aucune métadonnée : ni EXIF (GPS, appareil) ni profil.
    assert not served.getexif()
    assert "exif" not in served.info
    assert "icc_profile" not in served.info
    # Octets bruts : aucun bloc de métadonnées WebP (EXIF, XMP, ICCP) ni trace de la source.
    for size in ("thumb", "large"):
        webp = photos.read(ProgressPhoto.objects.get(pk=photo_id).file_key, size)
        for marker in (b"EXIF", b"XMP ", b"ICCP", b"Temoin", b"Appareil-Temoin"):
            assert marker not in webp
    # Orientation 6 (téléphone tourné) appliquée : l'image devient verticale.
    assert served.size == (200, 300)


def test_the_thumbnail_is_smaller_than_the_large_image() -> None:
    me = Athlete()
    photo_id = uuid4()
    me.put(photo_id, jpeg(2400, 1800))

    thumb = Image.open(io.BytesIO(me.get(f"{photo_id}/thumb/").content))
    large = Image.open(io.BytesIO(me.get(f"{photo_id}/large/").content))

    assert thumb.size == (480, 360)
    assert large.size == (1600, 1200)


@pytest.mark.parametrize(
    "data",
    [
        b"pas une image, mais du texte",
        # GIF : décodable par Pillow mais hors de la liste blanche.
        b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00"
        b",\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;",
    ],
)
def test_a_disguised_file_is_refused_without_leaving_files(
    data: bytes, private_media: Path
) -> None:
    response = Athlete().put(uuid4(), data)

    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["file"], "type": "invalid_image"}]
    assert files(private_media) == []


def test_a_decompression_bomb_is_refused_before_decoding(private_media: Path) -> None:
    # 8 000 sur 8 000 px (64 Mpx) dans quelques Ko : refusée sur ses dimensions annoncées.
    out = io.BytesIO()
    Image.new("1", (8000, 8000)).save(out, format="PNG")

    response = Athlete().put(uuid4(), out.getvalue(), kind="image/png")

    assert response.status_code == 422
    assert files(private_media) == []


def test_a_highly_compressed_large_png_is_refused(private_media: Path) -> None:
    # 7 700 sur 7 700 px (59 Mpx) en quelques centaines de Ko : sous le plafond du JPEG, mais
    # un PNG est décodé en entier (près de 800 Mo) : refusé au-delà de 16 Mpx.
    out = io.BytesIO()
    Image.new("RGBA", (7700, 7700)).save(out, format="PNG")

    response = Athlete().put(uuid4(), out.getvalue(), kind="image/png")

    assert response.status_code == 422
    assert files(private_media) == []


def test_an_oversized_or_wrongly_typed_upload_is_refused_early(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    me = Athlete()
    monkeypatch.setattr(photos, "MAX_UPLOAD_BYTES", 1000)

    assert me.put(uuid4(), jpeg()).status_code == 413
    assert me.put(uuid4(), b"x", kind="application/json").status_code == 415
    assert not ProgressPhoto.objects.exists()


def test_replacing_a_photo_removes_its_previous_files(
    private_media: Path, django_capture_on_commit_callbacks: OnCommit
) -> None:
    me = Athlete()
    photo_id = uuid4()
    with django_capture_on_commit_callbacks(execute=True):
        me.put(photo_id, jpeg())
    before = files(private_media)

    with django_capture_on_commit_callbacks(execute=True):
        replaced = me.put(photo_id, jpeg(), query="?date=2026-10-02&pose=side")

    assert replaced.status_code == 200
    assert replaced.json()["pose"] == "side"
    after = files(private_media)
    assert len(after) == 2
    assert not set(before) & set(after)


def test_deleting_a_photo_removes_its_files_and_is_idempotent(
    private_media: Path, django_capture_on_commit_callbacks: OnCommit
) -> None:
    me = Athlete()
    photo_id = uuid4()
    me.put(photo_id, jpeg())

    with django_capture_on_commit_callbacks(execute=True):
        assert me.delete(photo_id).status_code == 204
    assert me.delete(photo_id).status_code == 204
    assert files(private_media) == []
    assert me.get(f"{photo_id}/thumb/").status_code == 404


def test_another_account_cannot_read_replace_or_delete_my_photos() -> None:
    me, other = Athlete(), Athlete()
    photo_id = uuid4()
    me.put(photo_id, jpeg())

    assert other.get("?start=2026-09-01&end=2026-10-31").json() == []
    assert other.get(f"{photo_id}/large/").status_code == 404
    assert other.put(photo_id, jpeg(), query="?date=2026-10-05&pose=back").status_code == 404
    assert other.delete(photo_id).status_code == 204
    photo = ProgressPhoto.objects.get(pk=photo_id)
    assert (photo.owner_id, photo.pose) == (me.user.pk, "front")


def test_listing_returns_the_period_oldest_first() -> None:
    me = Athlete()
    first, second = uuid4(), uuid4()
    me.put(second, jpeg(), query="?date=2026-10-03&pose=back")
    me.put(first, jpeg(), query="?date=2026-10-01&pose=front")

    listing = me.get("?start=2026-09-01&end=2026-10-31").json()

    assert [row["id"] for row in listing] == [str(first), str(second)]


@pytest.mark.parametrize(
    "query", ["?date=2026-10-01&pose=nude", "?date=1999-12-31&pose=front", "?pose=front"]
)
def test_an_invalid_date_or_pose_is_refused(query: str, private_media: Path) -> None:
    assert Athlete().put(uuid4(), jpeg(), query=query).status_code == 422
    assert files(private_media) == []


def test_the_photo_cap_is_enforced_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch, private_media: Path
) -> None:
    me = Athlete()
    monkeypatch.setattr(services, "MAX_PHOTOS", 1)
    me.put(uuid4(), jpeg())

    refused = me.put(uuid4(), jpeg())

    assert refused.status_code == 422
    assert refused.json()["errors"] == [{"loc": ["photo_id"], "type": "too_many"}]
    assert len(files(private_media)) == 2


@override_settings(ACCOUNT_RATE_LIMITS={"body_photo_write": "1/3600s/user"})
def test_uploads_are_rate_limited_per_account() -> None:
    me = Athlete()

    assert me.put(uuid4(), jpeg()).status_code == 201
    assert me.put(uuid4(), jpeg()).status_code == 429


def test_photos_require_authentication(client: Client) -> None:
    photo_id = uuid4()
    assert client.get(f"{API}/").status_code == 401
    assert client.get(f"{API}/{photo_id}/large/").status_code == 401
    put = client.put(f"{API}/{photo_id}/{QUERY}", data=jpeg(), content_type="image/jpeg")
    assert put.status_code == 401


def test_photos_are_exported_and_their_files_deleted_with_the_account(
    private_media: Path, django_capture_on_commit_callbacks: OnCommit
) -> None:
    me = Athlete()
    photo_id = uuid4()
    me.put(photo_id, jpeg())

    assert export_account(me.user)["progress_photos"] == [
        {"id": str(photo_id), "date": "2026-10-01", "pose": "front"}
    ]
    with django_capture_on_commit_callbacks(execute=True):
        delete_account(user=me.user, password=TEST_PASSWORD)
    assert files(private_media) == []


def test_orphan_files_are_cleared_after_an_hour(private_media: Path) -> None:
    me = Athlete()
    me.put(uuid4(), jpeg())
    kept = files(private_media)
    old = photos.store({"thumb": b"a", "large": b"b"})
    recent = photos.store({"thumb": b"a", "large": b"b"})
    past = time.time() - ORPHAN_AGE_SECONDS - 60
    for path in private_media.glob(f"{old}-*"):
        os.utime(path, (past, past))

    assert clear_orphan_photos() == 1
    remaining = files(private_media)
    assert set(kept) <= set(remaining)
    assert not any(name.startswith(old) for name in remaining)
    assert any(name.startswith(recent) for name in remaining)


def test_a_missing_file_answers_404() -> None:
    me = Athlete()
    photo_id = uuid4()
    me.put(photo_id, jpeg())
    photos.remove(ProgressPhoto.objects.get(pk=photo_id).file_key)

    assert me.get(f"{photo_id}/large/").status_code == 404
