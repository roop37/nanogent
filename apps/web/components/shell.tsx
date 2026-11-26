import Link from "next/link";
import { SignOut } from "./sign-out";
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <nav aria-label="Main navigation" className="flex items-center gap-8">
            <Link href="/" className="text-xl font-bold tracking-tight">
              nanogent<span className="text-indigo-600">.</span>
            </Link>
            <Link href="/" className="text-sm font-medium text-slate-600 hover:text-indigo-700">
              Runs
            </Link>
          </nav>
          <SignOut />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">{children}</main>
    </>
  );
}
