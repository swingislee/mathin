import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const serviceUrl = new URL(process.env.FORMULA_OCR_URL?.trim() || "http://127.0.0.1:8503/pix2text");
const command = process.argv[2] || "serve";

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate)) return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known project-local or configured executable.
    }
  }
  return null;
}

async function checkService() {
  const healthUrl = new URL("/docs", serviceUrl.origin);
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    console.log(`Formula OCR is ready at ${serviceUrl.href}`);
  } catch {
    console.error(`Formula OCR is unavailable at ${serviceUrl.href}. Run "pnpm formula:ocr" first.`);
    process.exitCode = 1;
  }
}

async function serve() {
  const executable = await firstExisting([
    process.env.FORMULA_OCR_EXECUTABLE,
    process.platform === "win32"
      ? path.join(root, ".tmp", "formula-ocr", "Scripts", "p2t.exe")
      : path.join(root, ".tmp", "formula-ocr", "bin", "p2t"),
    "p2t",
  ]);
  if (!executable) {
    console.error("Pix2Text is not installed. Follow docs/runbooks/formula-ocr.md, then retry.");
    process.exitCode = 1;
    return;
  }

  const child = spawn(executable, [
    "serve",
    "-l", "en,ch_sim",
    "--disable-table",
    "-d", process.env.FORMULA_OCR_DEVICE?.trim() || "cpu",
    "-H", serviceUrl.hostname,
    "-p", serviceUrl.port || "8503",
  ], { cwd: root, stdio: "inherit", shell: false });

  child.once("error", (error) => {
    console.error(`Could not start Pix2Text: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) console.error(`Pix2Text stopped with signal ${signal}.`);
    process.exitCode = code ?? 1;
  });
}

if (command === "check") {
  await checkService();
} else if (command === "serve") {
  await serve();
} else {
  console.error(`Unknown command "${command}". Use "serve" or "check".`);
  process.exitCode = 1;
}
