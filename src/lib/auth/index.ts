// Self-hosted replacement for `@eazo/sdk/server`'s `requireAuth`.
//
// The original implementation decrypted an Eazo session token injected by the
// platform host. Off-platform there is no host, so we resolve a single fixed
// "demo" user instead. The demo user is lazily upserted into the local DB so
// that the `tasks.userId -> users.id` foreign key always has a matching row.
//
// Callers must `await requireAuth(request)` (it performs a DB write on first
// use per cold start).

import { upsertUser, getUserById } from "@/lib/db/queries/users";
import type { User } from "@/lib/db/schema/users";

export type { User };

export type AuthResult =
  | { ok: true; user: User; userId: string }
  | { ok: false; response: Response };

// IMPORTANT: these must resolve to the same values as the client-side shim in
// `src/lib/eazo-shim.ts`, otherwise the browser renders one identity while the
// server writes rows under another. The shim can only read `NEXT_PUBLIC_*`
// vars, so that prefix is the source of truth here too — the unprefixed names
// stay as a server-only fallback.
const DEMO_USER_ID =
  process.env.NEXT_PUBLIC_DEMO_USER_ID || process.env.DEMO_USER_ID || "demo-learner";
const DEMO_USER_NAME =
  process.env.NEXT_PUBLIC_DEMO_USER_NAME || process.env.DEMO_USER_NAME || "Demo Learner";
const DEMO_USER_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_USER_EMAIL || process.env.DEMO_USER_EMAIL || "demo@autotask.app";

// Cache the resolved row so we only hit the DB once per serverless cold start.
let cachedUser: User | null = null;

async function ensureDemoUser(): Promise<User> {
  if (cachedUser) return cachedUser;

  const existing = await getUserById(DEMO_USER_ID);
  if (existing) {
    cachedUser = existing;
    return existing;
  }

  const user = await upsertUser({
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    name: DEMO_USER_NAME,
  });
  cachedUser = user;
  return user;
}

export async function requireAuth(_request: Request): Promise<AuthResult> {
  try {
    const user = await ensureDemoUser();
    return { ok: true, user, userId: user.id };
  } catch (err) {
    // Self-hosted mode has no auth to fail — reaching here means the database
    // is unreachable or unmigrated. Returning 401 here would send whoever is
    // debugging on a hunt for a login bug that doesn't exist, so surface the
    // real cause as a 503 instead.
    console.error("[auth] failed to resolve demo user — check DATABASE_URL and that `bun run db:migrate` has been run:", err);
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Database unavailable",
          hint: "Check DATABASE_URL and run `bun run db:migrate` against it.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
}
