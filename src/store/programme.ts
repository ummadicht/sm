// A test programme says so in one short banner wherever the store app names the programme
// (owner, 2026-10-18: "a short banner for test programmes"). The SERVER says which programme is
// a test one (`org.demo` on /api/me and /api/tablet); the app never decides it. No React Native
// imports: ./programme.test.ts runs under plain node.

export const TEST_PROGRAMME = "Test programme — no real money";

/** The banner for the signed-in programme, or null for a real one. Only an explicit true is a test programme. */
export function programmeBanner(org: { demo?: unknown } | null | undefined): string | null {
  return org?.demo === true ? TEST_PROGRAMME : null;
}
