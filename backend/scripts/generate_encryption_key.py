"""Print a new FIELD_ENCRYPTION_KEYS entry:  python scripts/generate_encryption_key.py [version]

Put the output in your secret manager / Render env vars only. The key is shown
once and this script never writes it to a file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.security.crypto import generate_key  # noqa: E402

version = sys.argv[1] if len(sys.argv) > 1 else "1"
print(f"FIELD_ENCRYPTION_KEYS={version}:{generate_key()}")
print(f"FIELD_ENCRYPTION_KEY_VERSION={version}")
