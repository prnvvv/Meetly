#!/usr/bin/env node
/**
 * Creates (or reports on) the Meetly demo user in the Clerk instance whose
 * secret key is configured for local development.
 *
 *   npm run demo-user
 *
 * - Authentication stays with Clerk: the user is created through Clerk's
 *   Backend API, never by bypassing sign-in.
 * - CLERK_SECRET_KEY is read from the environment or frontend/.env.local and is
 *   never printed or logged. Nothing in this script ships to the browser.
 * - Safe to run repeatedly: an existing user is left untouched.
 *
 * DEMO_USER_PASSWORD is required (no default password is shipped). DEMO_USER_EMAIL is optional.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    /* file is optional */
  }
}

loadEnvFile(join(here, "..", ".env.local"));
loadEnvFile(join(here, "..", ".env"));

const secret = process.env.CLERK_SECRET_KEY;
const email = process.env.DEMO_USER_EMAIL ?? "demouser@gmail.com";
const password = process.env.DEMO_USER_PASSWORD;

if (!secret || !secret.startsWith("sk_")) {
  console.error(
    "CLERK_SECRET_KEY is not configured. Add it to frontend/.env.local " +
      "(Clerk Dashboard -> API keys) and run this script again.",
  );
  process.exit(1);
}
// Real keys are ASCII and ~50 characters. A short or non-ASCII value is almost
// always a redacted / truncated copy (for example "sk_test_..." with an ellipsis).
if (secret.length < 30 || /[^!-~]/.test(secret)) {
  console.error(
    "CLERK_SECRET_KEY looks truncated or redacted (too short, or it contains " +
      "non-ASCII characters such as an ellipsis). Copy the full Secret key from " +
      "Clerk Dashboard -> API keys into frontend/.env.local, restart the dev " +
      "server, and run this script again.",
  );
  process.exit(1);
}

if (!password || password.length < 12) {
  console.error("Set DEMO_USER_PASSWORD (at least 12 characters) in the environment. No default password is provided.");
  process.exit(1);
}

const API = "https://api.clerk.com/v1";

async function clerk(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

function describeError(body) {
  const errors = body?.errors;
  if (Array.isArray(errors) && errors.length) {
    return errors.map((e) => e.long_message || e.message || e.code).join("; ");
  }
  return JSON.stringify(body)?.slice(0, 200) ?? "unknown error";
}

const existing = await clerk(
  `/users?email_address=${encodeURIComponent(email)}&limit=1`,
);
if (existing.status !== 200) {
  console.error(`Could not query Clerk (HTTP ${existing.status}): ${describeError(existing.body)}`);
  process.exit(1);
}

const found = Array.isArray(existing.body) ? existing.body[0] : existing.body?.data?.[0];
if (found) {
  console.log(`Demo user already exists (id ${found.id}). Nothing to do.`);
  process.exit(0);
}

const created = await clerk("/users", {
  method: "POST",
  body: JSON.stringify({
    email_address: [email],
    password,
    // A short demo password would be rejected by Clerk's strength / breach checks.
    skip_password_checks: true,
    first_name: "Demo",
    last_name: "User",
  }),
});

if (created.status >= 200 && created.status < 300) {
  console.log(`Demo user created (id ${created.body.id}) for ${email}.`);
} else {
  console.error(`Clerk refused to create the user (HTTP ${created.status}): ${describeError(created.body)}`);
  process.exit(1);
}
