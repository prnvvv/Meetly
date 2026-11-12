"""Test configuration.

The existing suites exercise the API as the seeded demo user, so they run with
``AUTH_MODE=demo``. Authentication itself is covered in ``test_auth.py``, which
switches the setting per test. This runs before ``app`` is imported.
"""

import os
import tempfile

os.environ.setdefault("AUTH_MODE", "demo")

# Tests must NEVER touch a real database, even when backend/.env points at
# Supabase. Force a throwaway SQLite file and drop the migration URL before the
# app (and its engine) is imported.
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.gettempdir(), 'meetly_pytest_default.db')}"
os.environ["DATABASE_DIRECT_URL"] = ""
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""
