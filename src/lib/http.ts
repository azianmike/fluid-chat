import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_error"
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

export function errorResponse(error: unknown, headers?: Record<string, string>) {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status, headers);
  }

  if (error instanceof ZodError) {
    return json({ error: "Invalid request", code: "validation_error", issues: error.flatten() }, 400, headers);
  }

  console.error(error);
  return json({ error: "Internal server error", code: "internal_error" }, 500, headers);
}

export async function body<T>(request: Request, fallback: T): Promise<T> {
  const text = await request.text();
  if (!text) return fallback;
  return JSON.parse(text) as T;
}
