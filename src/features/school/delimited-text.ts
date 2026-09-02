export interface DelimitedRecord {
  line: number;
  cells: string[];
}

function delimiterFor(text: string): "," | "\t" {
  let commaCount = 0;
  let tabCount = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      break;
    } else if (!quoted && char === ",") commaCount += 1;
    else if (!quoted && char === "\t") tabCount += 1;
  }
  return tabCount > commaCount ? "\t" : ",";
}

/** Parse CSV/TSV text, including escaped quotes and quoted line breaks. */
export function parseDelimitedText(input: string): DelimitedRecord[] {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = delimiterFor(text);
  const records: DelimitedRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const finishRecord = () => {
    cells.push(cell.trim());
    if (cells.some((value) => value.trim() !== "")) records.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\r" || char === "\n") {
      const isCrLf = char === "\r" && text[index + 1] === "\n";
      if (quoted) cell += "\n";
      else finishRecord();
      if (isCrLf) index += 1;
      line += 1;
      if (!quoted) rowLine = line;
      continue;
    }
    cell += char;
  }

  if (cell !== "" || cells.length > 0) finishRecord();
  return records;
}
