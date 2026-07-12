import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config";

const resolvedPath = path.resolve(process.cwd(), config.dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

export const db = new DatabaseSync(resolvedPath);
db.exec("PRAGMA journal_mode = WAL;");
