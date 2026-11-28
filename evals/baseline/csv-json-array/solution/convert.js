import Papa from "papaparse";

export function convert(csv, format = "jsonl") {
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) throw new Error("Malformed CSV");
  if (new Set(parsed.meta.fields).size !== parsed.meta.fields.length)
    throw new Error("Duplicate CSV headers");
  if (format === "json") return `${JSON.stringify(parsed.data, null, 2)}\n`;
  return parsed.data.map((row) => `${JSON.stringify(row)}\n`).join("");
}
