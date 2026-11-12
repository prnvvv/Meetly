"""Safeguards against touching the wrong database or running destructive migrations."""

from __future__ import annotations

import ast
import pathlib
import re

import pytest
from sqlalchemy.engine import make_url

from app.database.target_guard import (
    UnsafeDatabaseTarget,
    check_downgrade_allowed,
    check_target,
    describe,
)

DEV = "postgresql://postgres.devdevdevdevdevdevde:pw@aws-0-x.pooler.supabase.com:5432/postgres"
PROD = "postgresql://postgres.prodprodprodprodprod:pw@aws-0-x.pooler.supabase.com:5432/postgres"
DIRECT = "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"


def env(**kw):
    return {k: v for k, v in kw.items()}


# ---- target identity --------------------------------------------------------------------


def test_describe_reads_the_project_ref_from_pooler_and_direct_urls():
    assert describe(make_url(DEV)).ref == "devdevdevdevdevdevde"
    assert describe(make_url(DIRECT)).ref == "abcdefghijklmnopqrst"
    sqlite = describe(make_url("sqlite:///x.db"))
    assert sqlite.is_sqlite and sqlite.ref is None


def test_sqlite_is_always_allowed():
    check_target(make_url("sqlite:///x.db"), app_env="production", command="alembic", env={})
    check_downgrade_allowed(make_url("sqlite:///x.db"), env={})


def test_a_shared_database_without_an_expected_ref_is_refused():
    with pytest.raises(UnsafeDatabaseTarget, match="DATABASE_EXPECTED_REF is not set"):
        check_target(make_url(DEV), app_env="local", env={"DATABASE_TARGET_ENV": "development"})


def test_the_connected_project_must_be_the_expected_one():
    e = {"DATABASE_EXPECTED_REF": "devdevdevdevdevdevde", "DATABASE_TARGET_ENV": "development"}
    check_target(make_url(DEV), app_env="local", env=e)  # fine
    with pytest.raises(UnsafeDatabaseTarget, match="different database"):
        check_target(make_url(PROD), app_env="local", env=e)  # the dev environment must not reach prod


def test_environments_cannot_be_mixed():
    e = {"DATABASE_EXPECTED_REF": "prodprodprodprodprod", "DATABASE_TARGET_ENV": "production"}
    with pytest.raises(UnsafeDatabaseTarget, match="mix environments"):
        check_target(make_url(PROD), app_env="local", env=e)  # a local app pointed at production
    with pytest.raises(UnsafeDatabaseTarget, match="mix environments"):
        check_target(make_url(DEV), app_env="production",
                     env={"DATABASE_EXPECTED_REF": "devdevdevdevdevdevde", "DATABASE_TARGET_ENV": "development"})


def test_target_env_must_be_declared():
    with pytest.raises(UnsafeDatabaseTarget, match="DATABASE_TARGET_ENV"):
        check_target(make_url(DEV), app_env="local", env={"DATABASE_EXPECTED_REF": "devdevdevdevdevdevde"})


def test_production_commands_need_an_explicit_confirmation_but_the_running_api_does_not():
    e = {"DATABASE_EXPECTED_REF": "prodprodprodprodprod", "DATABASE_TARGET_ENV": "production"}
    check_target(make_url(PROD), app_env="production", command="runtime", env=e)
    for command in ("alembic", "data-script"):
        with pytest.raises(UnsafeDatabaseTarget, match="MEETLY_CONFIRM_DB=prodprodprodprodprod"):
            check_target(make_url(PROD), app_env="production", command=command, env=e)
        with pytest.raises(UnsafeDatabaseTarget):
            check_target(make_url(PROD), app_env="production", command=command,
                         env={**e, "MEETLY_CONFIRM_DB": "some-other-ref"})
        check_target(make_url(PROD), app_env="production", command=command,
                     env={**e, "MEETLY_CONFIRM_DB": "prodprodprodprodprod"})


def test_development_commands_do_not_need_a_confirmation():
    e = {"DATABASE_EXPECTED_REF": "devdevdevdevdevdevde", "DATABASE_TARGET_ENV": "development"}
    check_target(make_url(DEV), app_env="local", command="alembic", env=e)


# ---- downgrades ---------------------------------------------------------------------------


def test_downgrade_is_refused_on_staging_and_production_even_with_the_override():
    for target_env in ("staging", "production"):
        with pytest.raises(UnsafeDatabaseTarget, match="only a development database"):
            check_downgrade_allowed(
                make_url(PROD), env={"DATABASE_TARGET_ENV": target_env, "ALEMBIC_ALLOW_DOWNGRADE": "1"}
            )


def test_downgrade_on_development_needs_the_explicit_override():
    with pytest.raises(UnsafeDatabaseTarget, match="ALEMBIC_ALLOW_DOWNGRADE=1"):
        check_downgrade_allowed(make_url(DEV), env={"DATABASE_TARGET_ENV": "development"})
    check_downgrade_allowed(make_url(DEV), env={"DATABASE_TARGET_ENV": "development", "ALEMBIC_ALLOW_DOWNGRADE": "1"})


def test_downgrade_with_no_declared_environment_is_refused():
    with pytest.raises(UnsafeDatabaseTarget):
        check_downgrade_allowed(make_url(DEV), env={"ALEMBIC_ALLOW_DOWNGRADE": "1"})


# ---- migrations never destroy data on the way up ------------------------------------------------

VERSIONS = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"
DESTRUCTIVE_SQL = re.compile(r"\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b", re.I)
DESTRUCTIVE_OPS = {"drop_table", "drop_column", "drop_constraint"}
APPROVAL = "destructive-approved:"


def _upgrade_nodes(source: str):
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade":
            yield from ast.walk(node)


def scan(source: str) -> list[str]:
    if APPROVAL in source:
        return []  # a reviewer wrote down why; the approval line is part of the revision
    problems = []
    for node in _upgrade_nodes(source):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in DESTRUCTIVE_OPS:
                problems.append(f"op.{node.func.attr}")
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and DESTRUCTIVE_SQL.search(node.value):
            problems.append(f"SQL: {node.value.strip()[:60]}")
    return problems


def test_the_scanner_really_flags_destructive_upgrades():
    bad = """
def upgrade():
    op.drop_table('users')
    op.execute('DELETE FROM meetings')
    op.execute('truncate x')
"""
    good = """
def upgrade():
    op.create_table('x')

def downgrade():
    op.drop_table('x')
"""
    assert len(scan(bad)) == 3
    assert scan(good) == []
    approved = "# destructive-approved: drops legacy table after data migration" + chr(10) + bad
    assert scan(approved) == []


@pytest.mark.parametrize("path", sorted(VERSIONS.glob("*.py")), ids=lambda p: p.name)
def test_upgrade_steps_never_destroy_data_unless_explicitly_approved(path):
    problems = scan(path.read_text())
    assert not problems, f"{path.name} upgrade() contains destructive steps: {problems}. " \
        f"Add a '# {APPROVAL} <reason>' line only after explicit approval."


def test_revisions_form_one_linear_history_with_no_gaps():
    revisions = {}
    for path in VERSIONS.glob("*.py"):
        text = path.read_text()
        rev = re.search(r"^revision\s*=\s*['\"](\w+)['\"]", text, re.M).group(1)
        down = re.search(r"^down_revision\s*=\s*(None|['\"](\w+)['\"])", text, re.M)
        revisions[rev] = down.group(2)
    heads = set(revisions) - {d for d in revisions.values() if d}
    assert len(heads) == 1, f"multiple heads: {heads}"
    assert sum(1 for d in revisions.values() if d is None) == 1, "exactly one base revision"
