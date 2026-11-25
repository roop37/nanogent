const marker = "\n[truncated]\n";
export function capOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  if (maxBytes < Buffer.byteLength(marker)) return { text: ".".repeat(maxBytes), truncated: true };
  const remaining = maxBytes - Buffer.byteLength(marker);
  const head = bytes
    .subarray(0, Math.ceil(remaining / 2))
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
  const tail = bytes
    .subarray(bytes.length - Math.floor(remaining / 2))
    .toString("utf8")
    .replace(/^\uFFFD+/u, "");
  return { text: head + marker + tail, truncated: true };
}
