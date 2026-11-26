export function Diff({ diff }: { diff: string }) {
  if (!diff) return <p className="p-5 text-slate-500">No changes recorded.</p>;
  const lines = diff.split("\n").map((text, number) => ({ text, number }));
  return (
    <section aria-label="Diff">
      <pre className="overflow-x-auto py-2 leading-6">
        {lines.map(({ text, number }) => {
          const header =
            text.startsWith("diff --git") || text.startsWith("--- ") || text.startsWith("+++ ");
          const color = header
            ? "bg-slate-100 font-semibold text-slate-800"
            : text.startsWith("+")
              ? "bg-emerald-50 text-emerald-900"
              : text.startsWith("-")
                ? "bg-red-50 text-red-900"
                : text.startsWith("@@")
                  ? "bg-indigo-50 text-indigo-800"
                  : "text-slate-600";
          return (
            <span key={number} className={`block min-h-6 px-5 ${color}`}>
              {text || " "}
            </span>
          );
        })}
      </pre>
    </section>
  );
}
