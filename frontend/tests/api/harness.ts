/**
 * Shared helpers for the API tests. These tests drive the real data layer (src/lib/api.ts and the stores) with no
 * browser, against either the built-in demo backend or a live backend, so one behaviour is checked in both places.
 */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const g = globalThis as Record<string, unknown>;
g.window = { sessionStorage: memory(), localStorage: memory(), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
g.sessionStorage = (g.window as { sessionStorage: unknown }).sessionStorage;
g.localStorage = (g.window as { localStorage: unknown }).localStorage;

export type Reporter = { ok: (condition: unknown, message: string) => void; rejects: (p: Promise<unknown>, status: number, message: string) => Promise<void>; passed: () => number; failed: () => number };

export function reporter(): Reporter {
  let passed = 0, failed = 0;
  return {
    ok(condition, message) { if (condition) { passed++; console.log(`  ok    ${message}`); } else { failed++; console.error(`  FAIL  ${message}`); } },
    async rejects(p, status, message) {
      try { await p; failed++; console.error(`  FAIL  ${message} (it did not reject)`); }
      catch (e) { const s = (e as { status?: number }).status; if (s === status) { passed++; console.log(`  ok    ${message} -> ${s}`); } else { failed++; console.error(`  FAIL  ${message}: expected ${status}, got ${s}`); } }
    },
    passed: () => passed,
    failed: () => failed,
  };
}

export const EMAILS = { creator: "aarav@acme.com", manager: "harshit@acme.com", reviewer: "priya@acme.com", admin: "ruchir@acme.com" } as const;

/** Signs in as one of the four seeded people, in whichever mode the run is using. */
export async function loginAs(email: string): Promise<void> {
  const { getMode } = await import("@/lib/api");
  const { signIn, signOut } = await import("@/lib/session");
  const { MOCK_PASSWORD } = await import("@/lib/mockData");
  signOut();
  await signIn(email, getMode() === "demo" ? MOCK_PASSWORD : "greenlight-demo");
}

/** Submits a draft as the creator and resolves every finding, leaving it in_review. */
export async function reviewInReview(title: string, content = "India's #1 fastest delivery, guaranteed. Act now!!!") {
  const { api } = await import("@/lib/api");
  const store = await import("@/features/reviews/lib/store");
  await loginAs(EMAILS.creator);
  const created = await store.createReview({ title, channel: "Email", mode: "Full brand review", brandKit: "x", content });
  for (const f of await api.getFindings(created.id)) {
    if (f.suggestion) await store.rewriteFinding(created.id, f.finding_id, f.suggestion.text, "suggestion");
    else await store.decideFinding(created.id, f.finding_id, "Disputed", "Reviewed and acceptable for this campaign");
  }
  return created.id;
}

export type TestModule = { name: string; run: (t: Reporter) => Promise<void> };
