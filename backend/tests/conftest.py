"""Test configuration.

The existing suites exercise the API as the seeded demo user, so they run with
``AUTH_MODE=demo``. Authentication itself is covered in ``test_auth.py``, which
switches the setting per test. This runs before ``app`` is imported.
"""

import os

os.environ.setdefault("AUTH_MODE", "demo")
