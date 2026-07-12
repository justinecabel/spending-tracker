import cors from "cors";
import express from "express";
import { router } from "./routes";
export const app = express();
app.use(cors({
    origin: true,
    credentials: true,
}));
app.use(express.json());
app.use(router);
app.use((error, _request, response, _next) => {
    response.status(500).json({
        message: error instanceof Error ? error.message : "Internal server error",
    });
});
