# Clerk setup

The API accepts a request only if its `Authorization: Bearer` token is a valid Clerk session token (RS256, checked against the instance's JWKS, issuer, expiry and the `azp` claim). The Clerk user id (`sub`) maps to one `users` row.

## Instances

| Environment | Clerk instance | Keys |
| --- | --- | --- |
| Development | development | `pk_test_` / `sk_test_` |
| Staging | a second development instance (or the same one with separate test users) | `pk_test_` / `sk_test_` |
| Production | **production** instance | `pk_live_` / `sk_live_` |

**A Clerk production instance needs a domain you own** (Clerk issues a `clerk.<your-domain>` frontend API and asks for DNS records). It cannot run on `*.vercel.app`. If you deploy without a domain, use a development instance and accept its limits (a "development mode" banner, a user cap, no custom-domain cookies); then set `MEETLY_ALLOW_CLERK_DEV_KEY=1` on Vercel to acknowledge it. That is a conscious trade-off, not a recommendation.

## Production instance (manual)

1. <https://dashboard.clerk.com> -> your application -> instance switcher (top left) -> **Create production instance** (clone the development settings if offered).
2. **Configure -> Domains**: enter your domain and add the DNS records Clerk lists at your DNS provider. Wait for every record to show verified, and for the certificate.
3. **API keys**: copy the **Publishable key** (`pk_live_...`) and **Secret key** (`sk_live_...`).
   - Vercel (Production): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
   - Render: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
4. Render `CLERK_AUTHORIZED_PARTIES` and `FRONTEND_URL`: the exact site origin(s), e.g. `https://meet.example.com` (no trailing slash). The API rejects tokens minted for another origin.
5. **Configure -> Paths**: sign-in `/`, sign-up `/sign-up`, after sign-in/up `/dashboard` (the same values as `frontend/.env.local.example`). **Allowed redirect / origins**: your site.
6. **Configure -> Email, phone, username**: keep what you use today (the app needs an email address; the profile asks for a username after sign-up).
7. Sign-in methods you enabled in development (e.g. Google) need their **own** OAuth credentials in production (Clerk -> SSO connections); the shared development credentials do not work in production.

## Verify

```bash
cd backend && python scripts/check_clerk_key.py     # prints type + fingerprint + ACTIVE
```

Then on the deployed site: sign up with a new account -> `/dashboard` loads -> in the browser network tab `GET <api>/api/users/me` is `200` -> sign out through the user menu -> `/dashboard` redirects to the landing page. Run `DEPLOYMENT_VERIFICATION.md` for the rest.

## What was and was not tested

Real Clerk **development** accounts and sessions were used for the browser tests in `e2e/` (sign-in, persistence, protected requests, 401 redirect). The production instance, a custom domain and third-party OAuth providers **have not** been exercised: they depend on your dashboard.

## Do not

- Use `pk_test_` or `sk_test_` keys in production, or the reverse.
- Put the secret key in a `NEXT_PUBLIC_` variable.
- Paste keys in chat; rotate if that ever happens (`SECRET_ROTATION.md`).
