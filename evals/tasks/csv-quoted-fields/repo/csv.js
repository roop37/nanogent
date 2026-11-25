export function parseLine(line) {
  return line.split(",").map((field) => field.trim());
}

export function parse(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseLine);
}
