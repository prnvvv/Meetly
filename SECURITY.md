# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**. Use GitHub's "Report a vulnerability" button on the repository's **Security** tab (private vulnerability reporting). Do not open a public issue or pull request for a security problem.

Include what you found, the steps to reproduce it, and the impact you expect. Do not include real user data or credentials. Please give the maintainers reasonable time to respond and fix the problem before disclosing it.

> Maintainer note: private vulnerability reporting must be enabled in the repository settings (Settings > Code security) before the repository is made public, otherwise this section has nowhere to send reports.

## Supported versions

Meetly has no tagged releases yet. Security fixes land on `main`.

## Handling secrets

- Secrets belong in environment variables or the hosting provider's secret store, never in the repository.
- If you accidentally commit a credential, treat it as compromised: rotate it first, then remove it. Deleting it from the latest commit does not remove it from Git history. See [`docs/security/SECRET_ROTATION.md`](docs/security/SECRET_ROTATION.md).
- Only variables intended for the browser may use the `NEXT_PUBLIC_` prefix. The Clerk secret key and the Supabase service-role key must stay on the server.

## Security design notes

See [`docs/architecture/SECURITY_ARCHITECTURE.md`](docs/architecture/SECURITY_ARCHITECTURE.md) and [`docs/security/RLS_AUDIT.md`](docs/security/RLS_AUDIT.md). Known gaps and items not yet reviewed are tracked in [`docs/maintenance/REPOSITORY_AUDIT.md`](docs/maintenance/REPOSITORY_AUDIT.md).
