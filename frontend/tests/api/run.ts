/** Usage: npm run test:demo   |   npm run test:live   (live needs the backend running; GREENLIGHT_API_URL overrides the address) */
const mode = process.argv[2];
if (mode !== "demo" && mode !== "live") { console.error("Usage: tsx tests/api/run.ts demo|live"); process.exit(2); }
process.env.NEXT_PUBLIC_USE_MOCK = mode === "demo" ? "true" : "false";
if (mode === "live") process.env.NEXT_PUBLIC_API_URL = process.env.GREENLIGHT_API_URL ?? "http://127.0.0.1:8000";

(async () => {
  const { reporter } = await import("./harness");
  const modules = [await import("./collaboration.test"), await import("./routing.test")];
  let passed = 0, failed = 0;
  for (const m of modules) {
    console.log(`\n${m.default.name} (${mode})`);
    const t = reporter();
    try { await m.default.run(t); } catch (e) { console.error("  CRASH", e); failed++; }
    passed += t.passed(); failed += t.failed();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
