export interface DelimitedRecord {
  line: number;
  cells: string[];
}

type Delimiter = "," | "\t" | "|";

function delimiterFor(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  if (firstLine.startsWith("|") && firstLine.endsWith("|")) return "|";

  let tabCount = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      break;
    } else if (!quoted && char === "\t") tabCount += 1;
  }
  // Spreadsheet clipboard data is tab-delimited even when a role cell itself
  // contains many commas, so any unquoted tab is the stronger signal.
  return tabCount > 0 ? "\t" : ",";
}

/** Parse CSV/TSV or a pasted Markdown table, including escaped quotes and quoted line breaks. */
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
    if (delimiter === "|" && cells[0] === "") cells.shift();
    if (delimiter === "|" && cells.at(-1) === "") cells.pop();
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
