from app.config.settings import Settings


def _prod(monkeypatch, **env):
    base = {
        "APP_ENV": "production",
        "AUTH_MODE": "clerk",
        "CLERK_PUBLISHABLE_KEY": "pk_test_YnJhdmUtYWlyZWRhbGUtOTUxOS5jbGVyay5hY2NvdW50cy5kZXYk",
        "CLERK_AUTHORIZED_PARTIES": "https://meetly.example",
        "FRONTEND_URL": "https://meetly.example",
        "DATABASE_URL": "postgresql://u:p@h:6543/d",
        "DATABASE_SSL_MODE": "require",
        "DATABASE_EXPECTED_REF": "abcdefghijklmnopqrst",
        "DATABASE_TARGET_ENV": "production",
    }
    base.update(env)
    for key, value in base.items():
        monkeypatch.setenv(key, value)
    return Settings()


def test_valid_production_has_no_problems(monkeypatch):
    assert _prod(monkeypatch).validate_for_production() == []


def test_demo_auth_blocked_in_production(monkeypatch):
    assert any("AUTH_MODE" in p for p in _prod(monkeypatch, AUTH_MODE="demo").validate_for_production())


def test_http_origin_blocked_in_production(monkeypatch):
    s = _prod(monkeypatch, FRONTEND_URL="http://meetly.example")
    assert any("https" in p for p in s.validate_for_production())


def test_missing_authorized_parties_blocked(monkeypatch):
    s = _prod(monkeypatch, CLERK_AUTHORIZED_PARTIES="")
    assert any("AUTHORIZED_PARTIES" in p for p in s.validate_for_production())


def test_ssl_disable_blocked(monkeypatch):
    s = _prod(monkeypatch, DATABASE_SSL_MODE="disable")
    assert any("SSL" in p for p in s.validate_for_production())


def test_local_env_never_blocked(monkeypatch):
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("AUTH_MODE", "demo")
    assert Settings().validate_for_production() == []


def test_pg_url_normalized():
    from app.database.database import normalize_database_url

    assert normalize_database_url("postgres://u:p@h/d").drivername == "postgresql+psycopg"
    assert normalize_database_url("postgresql://u:p@h/d").drivername == "postgresql+psycopg"
    assert normalize_database_url("sqlite:///x.db").drivername == "sqlite"


def test_production_refuses_sqlite_or_a_missing_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    s = _prod(monkeypatch, DATABASE_URL="")
    assert any("SQLite" in p for p in s.validate_for_production())
    s = _prod(monkeypatch, DATABASE_URL="sqlite:////var/data/meetly.db")
    assert any("SQLite" in p for p in s.validate_for_production())


def test_legacy_sqlite_production_needs_an_explicit_opt_in(monkeypatch):
    s = _prod(monkeypatch, DATABASE_URL="sqlite:////var/data/meetly.db", ALLOW_SQLITE_IN_PRODUCTION="1")
    assert not any("SQLite" in p for p in s.validate_for_production())
