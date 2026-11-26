export function Diff({ diff }: { diff: string }) {
  if (!diff) return <p className="p-5 text-muted-foreground">No changes recorded.</p>;
  const lines = diff.split("\n").map((text, number) => ({ text, number }));
  return (
    <section aria-label="Diff">
      <pre className="overflow-x-auto py-2 leading-6">
        {lines.map(({ text, number }) => {
          const header =
            text.startsWith("diff --git") || text.startsWith("--- ") || text.startsWith("+++ ");
          const color = header
            ? "bg-panel font-semibold text-foreground"
            : text.startsWith("+")
              ? "bg-added text-foreground"
              : text.startsWith("-")
                ? "bg-removed text-foreground"
                : text.startsWith("@@")
                  ? "bg-selection text-link"
                  : "text-muted-foreground";
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
