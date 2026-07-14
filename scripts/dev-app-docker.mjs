import { execFileSync, spawn } from "node:child_process";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

try {
  const containerId = run("docker", ["compose", "ps", "tailscale", "--status", "running", "-q"]);
  if (!containerId) {
    throw new Error("The Tailscale sidecar is not running. Start it with: docker compose up -d");
  }

  const status = JSON.parse(run("docker", ["exec", containerId, "tailscale", "status", "--json"]));
  const dnsName = String(status?.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!dnsName) {
    throw new Error("Tailscale has not finished logging in. Run tailscale up in the sidecar first.");
  }

  const apiUrl = `https://${dnsName}`;
  console.log(`Starting the web app against Docker API: ${apiUrl}`);
  const child = spawn(pnpmCommand, ["--filter", "@spending-tracker/mobile-web", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
