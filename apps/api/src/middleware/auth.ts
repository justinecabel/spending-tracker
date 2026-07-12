import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth";

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Missing bearer token" });
    return;
  }

  try {
    request.user = verifyAccessToken(header.replace("Bearer ", ""));
    next();
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
}
