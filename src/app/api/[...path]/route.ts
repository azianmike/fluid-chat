import { NextRequest } from "next/server";
import { handleApiRequest } from "@/server";

type Params = { params: Promise<{ path?: string[] }> };

async function dispatch(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return handleApiRequest(request, path ?? []);
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
