import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-fg-2">This address does not match any page in the dashboard.</p>
      <Link href="/overview" className="text-accent underline">
        Go to the overview
      </Link>
    </main>
  );
}
