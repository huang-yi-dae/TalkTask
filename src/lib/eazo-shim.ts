"use client";

// Self-hosted drop-in shim for @eazo/sdk / @eazo/sdk/react.
//
// AutoTask was originally built to run inside the Eazo platform, where auth,
// the session token, push notifications and long-term memory are all owned by
// the platform. When deployed to a generic host (Vercel, etc.) those
// capabilities are unavailable, so this module provides a minimal local
// implementation that keeps the exact same import surface the app already
// uses:
//   - auth (singleton: user / getSessionHeader / login / logout)
//   - memory (reportAction no-op)
//   - useEazo(selector)  — zustand-style selector hook
//   - EazoProvider        — passthrough provider
//   - User (type)
//
// There is no real login: a single fixed "demo" user is used everywhere.

import type { ReactNode } from "react";
import type { User } from "@/lib/db/schema/users";

export type { User };

const DEMO_USER_ID = process.env.NEXT_PUBLIC_DEMO_USER_ID || "demo-learner";
const DEMO_USER_NAME = process.env.NEXT_PUBLIC_DEMO_USER_NAME || "Demo Learner";
const DEMO_USER_EMAIL = process.env.NEXT_PUBLIC_DEMO_USER_EMAIL || "demo@autotask.app";

/** The single fixed user every visitor is "logged in" as. */
export const DEMO_USER: User = {
  id: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  name: DEMO_USER_NAME,
  avatarUrl: null,
  // Deterministic dates avoid SSR/CSR hydration mismatches (never rendered).
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

type EazoState = {
  auth: { user: User | null; loading: boolean; authenticated: boolean };
  device: { platform: "web" | "mobile" };
};

const STATE: EazoState = {
  auth: { user: DEMO_USER, loading: false, authenticated: true },
  device: { platform: "web" },
};

/** Mirrors `@eazo/sdk/react`'s `useEazo` selector hook. */
export function useEazo<T>(selector: (s: EazoState) => T): T {
  return selector(STATE);
}

/** Mirrors `@eazo/sdk`'s `auth` singleton. */
export const auth = {
  user: DEMO_USER,
  async getSessionHeader(): Promise<string | null> {
    return null;
  },
  async login(): Promise<void> {
    // No-op: self-hosted mode has no real login flow.
  },
  async logout(): Promise<void> {
    // No-op: self-hosted mode has no real logout flow.
  },
};

/** Mirrors `@eazo/sdk`'s `memory` singleton (long-term user memory reporting). */
export const memory = {
  async reportAction(_input: { content: string; event_type: string }): Promise<void> {
    // No-op: platform-owned long-term memory is unavailable off-platform.
  },
};

/**
 * Drop-in for `@eazo/sdk/react`'s `EazoProvider` — a pure passthrough.
 * Written without JSX so this file can stay a plain `.ts` module.
 */
export function EazoProvider({ children }: { children: ReactNode }) {
  return children;
}
