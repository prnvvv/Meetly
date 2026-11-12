# Account email encryption

## Who owns what
| Data | Where it lives | Notes |
| --- | --- | --- |
| Identity, sign-in, passwords, email verification, account recovery | **Clerk** | Meetly never sees a password. Clerk stays the source of truth for the email. |
| Meetly profile (username, display name, bio, photo, visibility) | Meetly database | Intentionally searchable and shown to others; not encrypted. |
| A **copy of the account email** | Meetly database, `users` table | Fetched from Clerk on first sign-in. Used for exactly one thing: showing the owner their own address in `GET /api/users/me`. This is the sensitive field we encrypt. |

Compatibility with the existing architecture (checked in the code): the email is **not** used to sign in (the Clerk id is), **not** used for friend discovery (username/display name), **not** used for invitations (internal user ids) and never returned to anyone but its owner. The only lookup by email in the codebase is the demo-user seed. So encrypting it cannot affect login, registration, recovery (Clerk's), discovery or invitations; the blind index exists for exact-match lookup and de-duplication, as asked.

## Design
- **Encryption:** AES-256-GCM, random 96-bit nonce per value, authentication tag verified on decrypt, stored as one versioned envelope `enc:v1:<key_version>:<base64(nonce || ciphertext || tag)>` in `users.email_ciphertext`; `users.email_key_version` repeats the key version for queries. The authenticated data is `users.email:<user id>`, so a ciphertext copied onto another row cannot be decrypted.
- **Blind index:** `users.email_blind_index = HMAC-SHA-256(index_key, "users.email:v1:" + normalised_email)` (hex), `users.email_bidx_version` records which key. It is **keyed** (an unkeyed SHA-256 would be guessable by anyone with the database), **domain-separated**, and uses a **separate key** from the encryption key. Exact-match only.
- **Uniqueness:** a partial unique index on `email_blind_index` (where not null) replaces what the plaintext `UNIQUE` column did; two spellings of one mailbox collide.
- **Normalisation:** Unicode NFKC, trimmed, lower-cased; validated shape. Dots and `+tags` are deliberately **not** merged (provider-specific).
- **Keys:** `FIELD_ENCRYPTION_KEYS` / `FIELD_ENCRYPTION_KEY_VERSION` and `FIELD_BLIND_INDEX_KEYS` / `FIELD_BLIND_INDEX_KEY_VERSION`, all `version:key[,version:key]`, 32 random bytes base64url (`python backend/scripts/generate_encryption_key.py`). Only in environment variables: never in the database, git, frontend variables, logs or reports. Use different keys in every environment.
- **Failure handling:** missing or malformed keys fail the API **at start-up** (any mode but `off`); a wrong key or damaged data at runtime makes `get_email` return nothing (falling back to the plaintext while it still exists) and logs only a user id, never an address or key. Sign-in never depends on decryption.
- **Single access point:** `app/services/account_email.py` (`set_email`, `get_email`, `find_by_email`). `User.__repr__` no longer includes the address.

## Roll-out (expand, migrate, contract)
`EMAIL_ENCRYPTION_MODE`:
| Mode | New/updated accounts | Reads |
| --- | --- | --- |
| `off` (default) | plaintext only (today) | plaintext |
| `dual` | plaintext **and** ciphertext + index | ciphertext, else plaintext |
| `encrypted` | ciphertext + index; plaintext column holds `masked-<id>@masked.invalid` | ciphertext only |

1. **Expand** - migration `0009` (additive: 4 nullable columns + the partial unique index). Applied to the development Supabase project. The pre-Alembic SQLite start-up migrator creates the same columns, so today's production SQLite file upgrades itself when this release is deployed.
2. **Dual-write** - set the keys and `EMAIL_ENCRYPTION_MODE=dual`. Every new sign-in is stored both ways.
3. **Backfill** - `python scripts/backfill_email_encryption.py` (dry run), then `--apply` (batches, resumable, only **adds** columns), then `verify` (decrypts every row and cross-checks the index and the plaintext). The report has counts and user ids only. Rows with no real address (`masked-...`) or an invalid one are skipped; two rows that normalise to the same mailbox are reported as conflicts and left unencrypted for a human to resolve.
4. **Switch reads/writes** - set `EMAIL_ENCRYPTION_MODE=encrypted` (new accounts stop storing plaintext).
5. **Contract (destructive, needs your approval)** - take and verify a backup, then `scrub --apply --i-have-a-verified-backup` replaces remaining plaintext with the placeholder, only if **every** row verifies (it refuses otherwise; on staging/production it also needs `MEETLY_CONFIRM_DB=<ref>`). Dropping the plaintext column afterwards is a separate Alembic revision with a `destructive-approved:` line. **Neither has been run on any shared database.**

State today: the development database has the columns (revision `0009`), mode `dual`, and its single account is encrypted and verified; **production has not changed** (it will upgrade additively on its next deploy and stays in mode `off` until you opt in).

## Key rotation
- **Encryption key:** add the new key (`1:old,2:new`), set `FIELD_ENCRYPTION_KEY_VERSION=2`, run `rekey --apply` (re-encrypts rows that are not on the active version), `verify`, then remove key `1`.
- **Blind-index key:** same procedure with `FIELD_BLIND_INDEX_KEYS` / `..._VERSION`; `rekey` recomputes the index. During the overlap, lookups try the index under every configured version.
- Both procedures are tested (`test_rekey_moves_rows_to_the_active_key_versions_and_keeps_them_readable`).

## Tests
`backend/tests/test_email_encryption.py` (44 tests): normalisation, keyed/domain-separated index, rotation, missing/invalid keys, tampering, row binding, wrong-key fallback with log hygiene, duplicate prevention, case-insensitive lookup, legacy rows, sign-up and login through the real token path (including two accounts with one address), friend discovery without email, the whole backfill/verify/rekey/scrub lifecycle, and "no address or key in any log or report". The PostgreSQL uniqueness and RLS behaviour of the new columns is covered in `tests/test_rls_postgres.py`.
