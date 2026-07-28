import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { router } from "./routes";

export const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(router);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ message: "Invalid request", issues: error.flatten() });
    return;
  }

  if (error instanceof Error && /not found$/i.test(error.message)) {
    response.status(404).json({ message: error.message });
    return;
  }

  response.status(500).json({ message: "Internal server error" });
});
