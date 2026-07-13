import fs from "node:fs";
import path from "node:path";

const configuredBaseUrl = process.env.EXPO_PUBLIC_BASE_URL ?? "";
const baseUrl = configuredBaseUrl ? configuredBaseUrl.replace(/\/$/, "") : "";
const output = path.resolve("apps/mobile-web/dist/404.html");

fs.writeFileSync(
  output,
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Opening Spend</title>
    <script>
      const base = ${JSON.stringify(baseUrl)};
      const path = window.location.pathname.startsWith(base)
        ? window.location.pathname.slice(base.length)
        : window.location.pathname;
      const route = path.replace(/^\\/+/, "");
      window.location.replace(base + "/#/" + route + window.location.search);
    </script>
  </head>
  <body></body>
</html>`,
);
