import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const appDirectory = resolve(projectRoot, "apps", "mobile-web");
const buildId = process.env.EXPO_PUBLIC_BUILD_ID ?? process.env.GITHUB_SHA ?? `local-${Date.now()}`;
// Resolve from the web workspace, where pnpm links Expo in both local and CI
// installs. The repository root does not necessarily have an Expo binary.
const appRequire = createRequire(resolve(appDirectory, "package.json"));
const expoCli = appRequire.resolve("expo/bin/cli");

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
const iconFontSource = appRequire.resolve("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf");
const iconFontOutput = resolve(appDirectory, "dist", "assets", "material-community.ttf");
await mkdir(dirname(iconFontOutput), { recursive: true });
await copyFile(iconFontSource, iconFontOutput);
await writeFile(
  outputPath,
  `${JSON.stringify({ id: buildId, createdAt: new Date().toISOString() })}\n`,
  "utf8",
);
