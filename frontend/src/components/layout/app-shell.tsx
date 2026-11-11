"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { site } from "@/config/site";
import { ToastProvider } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { useHydrated } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { TourBar } from "@/features/tour/tour-bar";
import { reloadReviews, useReviewsError } from "@/features/reviews/lib/store";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useTheme(); // keeps <html data-theme> in sync with the stored preference
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useSession();
  const loadError = useReviewsError();
  useEffect(() => { if (hydrated && !user) router.replace("/login"); }, [hydrated, user, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!hydrated || !user) return <div className="min-h-screen bg-page" aria-busy="true" />;

  return (
    <ToastProvider>
      <div className="min-h-screen bg-page text-ink">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] lg:block"><Sidebar /></aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button aria-label="Close navigation" className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="relative h-full w-[280px] animate-fade-in shadow-2xl"><Sidebar onNavigate={() => setMobileOpen(false)} /></aside>
          </div>
        )}
        <div className="lg:pl-[256px] print:pl-0">
          <Topbar onMenu={() => setMobileOpen(true)} onSearch={() => setPaletteOpen(true)} />
          <main className="mx-auto min-h-[calc(100vh-110px)] max-w-[1360px] px-4 py-7 md:px-8 md:py-9 print:max-w-none print:p-0">
            <TourBar />
            {loadError && (
              <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/10 p-3.5 text-sm text-danger">
                <span>{loadError}</span>
                <button onClick={reloadReviews} className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-bold hover:bg-danger/10">Try again</button>
              </div>
            )}
            {children}
          </main>
          <footer className="px-6 py-5 text-center text-xs text-muted">{site.name} · People make the final decision.</footer>
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </ToastProvider>
  );
}
