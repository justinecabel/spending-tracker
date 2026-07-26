import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicAsset = (name: string) => new URL(`../public/${name}`, import.meta.url);
const productionUrl = "https://justinecabel.github.io/spending-tracker/";

describe("search engine assets", () => {
  it("provides canonical metadata and meaningful pre-rendered content", () => {
    const html = readFileSync(publicAsset("index.html"), "utf8");

    expect(html).toContain(`<link rel="canonical" href="${productionUrl}"`);
    expect(html).toContain('name="robots" content="index, follow');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type": "WebApplication"');
    expect(html).toContain("<h1>Private, offline-ready spending tracker</h1>");
    expect(html).toContain("Record expenses manually");
  });

  it("publishes only the canonical public page in the sitemap", () => {
    const sitemap = readFileSync(publicAsset("sitemap.xml"), "utf8");
    const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);

    expect(locations).toEqual([productionUrl]);
    expect(sitemap).not.toContain("#/");
  });

  it("prevents the GitHub Pages route fallback from becoming a search result", () => {
    const fallbackGenerator = readFileSync(
      new URL("../../../scripts/create-pages-404.mjs", import.meta.url),
      "utf8",
    );

    expect(fallbackGenerator).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
});
