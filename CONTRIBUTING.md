# Contributing to Meetly

Thanks for helping. This guide covers how to set up, what a good change looks like, and how reviews work.

## Getting set up

Follow the "Quick start" section of the [README](README.md): a Python 3.13 virtual environment for `backend/`, Node 22 for `frontend/`, and your own Clerk development keys. Use a local SQLite database or a throwaway PostgreSQL database. Never point development tooling at a shared or production database.

## Workflow

1. Open an issue first for anything larger than a small fix, so the approach can be agreed.
2. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>` or `chore/<topic>`.
3. Make small, focused commits.
4. Open a pull request against `main` and fill in the template.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, for example `fix(backend): reject expired invitations`. Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Keep the summary short and in the imperative mood.

## Before you open a pull request

Frontend (`frontend/`):

```bash
npm run typecheck
npm run lint
npm test
```

Backend (`backend/`):

```bash
python -m pytest
```

The backend test suite runs against an isolated SQLite file and does not touch the database in your `.env`. PostgreSQL and Row Level Security tests are opt-in; see the "Testing and CI" section of the README. CI also builds the frontend and applies the migrations to an empty PostgreSQL.

## Standards

- **Tests:** new behavior and bug fixes come with tests. Do not delete or weaken a failing test to get CI green; find the cause.
- **Database changes:** ship an Alembic migration in `backend/alembic/versions/`. The schema is never altered at application startup on PostgreSQL, and migrations must be reversible.
- **API contracts:** do not change request or response shapes without discussing it in an issue; the frontend and tests depend on them.
- **Design:** reuse existing components and design tokens (see [`docs/design-system.md`](docs/design-system.md)) rather than adding new ones.
- **Secrets:** never commit `.env` files, keys, tokens or personal data. Update the `.env.example` files when you add a variable, and use placeholders only. Do not use `NEXT_PUBLIC_` for anything secret.
- **Dependencies:** add one only when the standard library or an existing dependency cannot do the job, and say why in the pull request.
- **Logging:** use the `logging` module in the backend; no stray `print` or `console.log`.

## License

By contributing you agree that your contribution is released under the project's [MIT License](LICENSE).

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
