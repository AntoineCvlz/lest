import pytest

from common.pagination import (
    MAX_CURSOR_LENGTH,
    InvalidCursorError,
    decode_cursor,
    encode_cursor,
)


def test_a_cursor_round_trips() -> None:
    assert decode_cursor(encode_cursor(["Développé", "abc"]), size=2) == ["Développé", "abc"]


@pytest.mark.parametrize(
    "values",
    [[], ["a"], ["a", "b", "c"]],
)
def test_a_cursor_of_the_wrong_size_is_refused(values: list[str]) -> None:
    with pytest.raises(InvalidCursorError):
        decode_cursor(encode_cursor(values), size=2)


@pytest.mark.parametrize("cursor", ["eyJhIjoxfQ", "WzEsMl0", "/w"])  # objet, entiers, non UTF-8
def test_a_cursor_with_unexpected_content_is_refused(cursor: str) -> None:
    with pytest.raises(InvalidCursorError):
        decode_cursor(cursor, size=2)


def test_the_longest_name_fits_in_a_cursor() -> None:
    cursor = encode_cursor(["🏋" * 200, "cd256082-4090-4e71-b1a5-c375ebac7c58"])

    assert len(cursor) <= MAX_CURSOR_LENGTH


def test_an_oversized_cursor_is_refused() -> None:
    with pytest.raises(InvalidCursorError):
        decode_cursor("A" * (MAX_CURSOR_LENGTH + 1), size=2)
