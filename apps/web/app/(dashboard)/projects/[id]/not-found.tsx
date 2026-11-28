import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-8">
      <h1 className="text-xl font-medium">Project not found</h1>
      <Link className="text-link underline" href="/projects">
        Back to projects
      </Link>
    </section>
  );
}
