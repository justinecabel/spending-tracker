import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Spending Tracker",
  slug: "spending-tracker",
  scheme: "spendingtracker",
  version: "0.1.0",
  platforms: ["web"],
  orientation: "default",
  userInterfaceStyle: "light",
  experiments: {
    typedRoutes: true,
    // GitHub Pages project sites are served below /<repository>.
    // Local development keeps the app at the domain root.
    baseUrl: process.env.EXPO_PUBLIC_BASE_URL ?? "",
  },
  web: {
    bundler: "metro",
    favicon: "./public/icon-192.png",
  },
  extra: {
    eas: {
      projectId: "d6cd776e-fb6e-48ed-b363-466277bfd0ff",
    },
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000",
    googleExpoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID ?? "",
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  },
};

export default config;
