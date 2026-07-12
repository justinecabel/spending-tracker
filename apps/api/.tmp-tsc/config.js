import dotenv from "dotenv";
dotenv.config();
export const config = {
    port: Number(process.env.PORT ?? 4000),
    apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
    jwtSecret: process.env.JWT_SECRET ?? "change-me",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    dbPath: process.env.DB_PATH ?? "./data/spending-tracker.sqlite",
};
