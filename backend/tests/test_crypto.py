import pytest

from app.security.crypto import (
    CryptoConfigError,
    DecryptionError,
    FieldCipher,
    generate_key,
)


def make(active="1"):
    return FieldCipher.from_settings(f"{active}:{generate_key()}", active)


def test_round_trip_and_format():
    c = make()
    token = c.encrypt("secret note", aad="users.note:1")
    assert token.startswith("enc:v1:1:") and "secret" not in token
    assert c.decrypt(token, aad="users.note:1") == "secret note"


def test_nonce_unique_per_call():
    c = make()
    assert c.encrypt("x", aad="a") != c.encrypt("x", aad="a")


def test_wrong_aad_rejected():
    c = make()
    token = c.encrypt("x", aad="users.note:1")
    with pytest.raises(DecryptionError):
        c.decrypt(token, aad="users.note:2")


def test_tampering_rejected():
    c = make()
    token = c.encrypt("hello", aad="a")
    flipped = token[:-3] + ("AAA" if not token.endswith("AAA") else "BBB")
    with pytest.raises(DecryptionError):
        c.decrypt(flipped, aad="a")


@pytest.mark.parametrize("bad", ["", "plain", "enc:v2:1:abc", "enc:v1:1:", "enc:v1:9:AAAA"])
def test_malformed_rejected(bad):
    with pytest.raises(DecryptionError):
        make().decrypt(bad, aad="a")


def test_rotation():
    old = make("1")
    new_key = FieldCipher.from_settings(f"2:{generate_key()}", "2").keys["2"]
    new = FieldCipher(keys={**old.keys, "2": new_key}, active_version="2")
    token = old.encrypt("data", aad="a")
    assert new.decrypt(token, aad="a") == "data"  # old key still decrypts
    assert new.needs_rotation(token)
    rotated = new.rotate(token, aad="a")
    assert rotated.startswith("enc:v1:2:") and not new.needs_rotation(rotated)
    assert new.rotate(rotated, aad="a") == rotated
    with pytest.raises(DecryptionError):
        old.decrypt(rotated, aad="a")  # retired key cannot read new data


@pytest.mark.parametrize(
    "spec,active",
    [("", "1"), ("1:abc", "1"), ("nokey", "1"), (f"1:{generate_key()}", "2")],
)
def test_bad_config(spec, active):
    with pytest.raises(CryptoConfigError):
        FieldCipher.from_settings(spec, active)
