export function parseLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      fields.push(wasQuoted ? field : field.trim());
      field = "";
      wasQuoted = false;
    } else {
      field += ch;
    }
  }
  fields.push(wasQuoted ? field : field.trim());
  return fields;
}

export function parse(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseLine);
}
