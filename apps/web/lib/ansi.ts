export type AnsiSpan = { text: string; color?: string; bold: boolean; offset: number };
const colors = [
  "#9d9d9d",
  "#f88078",
  "#73c991",
  "#e2c56c",
  "#79b8ff",
  "#d7a0dc",
  "#73daca",
  "#cccccc",
  "#9d9d9d",
  "#ff9b93",
  "#a0dfb1",
  "#f5df95",
  "#a1cfff",
  "#e9bcf0",
  "#a0eadf",
  "#ffffff",
];
export function parseAnsi(value: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let color: string | undefined;
  let bold = false;
  // Strip OSC payloads (including hyperlinks) and interpret only SGR styling.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences
  const text = value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal SGR sequences
  const escapes = /\x1b\[([0-9;]*)([A-Za-z])/g;
  let cursor = 0;
  const append = (end: number) => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal controls
    const content = text.slice(cursor, end).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    if (content) spans.push({ text: content, ...(color ? { color } : {}), bold, offset: cursor });
  };
  for (const match of text.matchAll(escapes)) {
    append(match.index);
    if (match[2] === "m") {
      const codes = (match[1] || "0").split(";").map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i] ?? 0;
        if (code === 0) {
          color = undefined;
          bold = false;
        } else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 39) color = undefined;
        else if (code >= 30 && code <= 37) color = colors[code - 30];
        else if (code >= 90 && code <= 97) color = colors[code - 90 + 8];
        else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
          const rgb = codes.slice(i + 2, i + 5);
          if (code === 38 && rgb.length === 3 && rgb.every((n) => n >= 0 && n <= 255))
            color = `rgb(${rgb.join(",")})`;
          i += 4;
        } else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
          const n = codes[i + 2] ?? 0;
          if (code === 38 && n >= 0 && n < 256) {
            const c = n - 16;
            const channel = (v: number) => (v === 0 ? 0 : 55 + v * 40);
            color =
              n < 16
                ? colors[n]
                : n >= 232
                  ? `rgb(${Array(3)
                      .fill(8 + (n - 232) * 10)
                      .join(",")})`
                  : `rgb(${[Math.floor(c / 36), Math.floor(c / 6) % 6, c % 6].map(channel).join(",")})`;
          }
          i += 2;
        }
      }
    }
    cursor = match.index + match[0].length;
  }
  append(text.length);
  return spans;
}
