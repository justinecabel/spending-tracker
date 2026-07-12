import { readFile, writeFile } from "node:fs/promises";

const outputPath = new URL("../dist/index.js", import.meta.url);
const output = await readFile(outputPath, "utf8");
const corrected = output.replace('from "sqlite"', 'from "node:sqlite"');

if (corrected === output) {
  throw new Error("Expected the production bundle to contain the SQLite built-in import.");
}

await writeFile(outputPath, corrected);
