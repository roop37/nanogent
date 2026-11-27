import Link from "next/link";
export default function MissingRun() {
  return (
    <section className="p-6">
      <h1 className="text-xl font-medium">Run not found</h1>
      <p className="my-3 text-muted-foreground">This run is unavailable in your account.</p>
      <Link className="text-link underline" href="/">
        Back to runs
      </Link>
    </section>
  );
}
