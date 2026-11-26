import { Badge } from "./ui/badge";
export function Status({ state }: { state: string }) {
  const color =
    state === "completed"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : state === "failed"
        ? "bg-red-50 text-red-800 border-red-200"
        : state === "canceled"
          ? "bg-slate-100 text-slate-700"
          : "bg-indigo-50 text-indigo-800 border-indigo-200";
  return (
    <Badge variant="outline" className={`rounded-md px-2 py-1 text-sm font-normal ${color}`}>
      {state.replaceAll("_", " ")}
    </Badge>
  );
}
