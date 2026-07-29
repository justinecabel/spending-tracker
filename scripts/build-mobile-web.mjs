import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const appDirectory = resolve(projectRoot, "apps", "mobile-web");
const buildId = process.env.EXPO_PUBLIC_BUILD_ID ?? process.env.GITHUB_SHA ?? `local-${Date.now()}`;
const expoCli = resolve(projectRoot, "node_modules", "expo", "bin", "cli");

// The build identifier is compiled into the bundle, so Metro's transform cache
// must not reuse a bundle created for an earlier identifier.
const exportResult = spawnSync(process.execPath, [expoCli, "export", "--platform", "web", "--clear"], {
  cwd: appDirectory,
  env: { ...process.env, EXPO_PUBLIC_BUILD_ID: buildId },
  stdio: "inherit",
});

if (exportResult.status !== 0) {
  process.exit(exportResult.status ?? 1);
}

const outputPath = resolve(appDirectory, "dist", "build-info.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ id: buildId, createdAt: new Date().toISOString() })}\n`,
  "utf8",
);
