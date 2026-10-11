import { getAuth } from "@/lib/auth";

// Handlers resolve the auth instance per request so `next build` never needs the secret.
export const GET = (request: Request): Promise<Response> => getAuth().handler(request);
export const POST = (request: Request): Promise<Response> => getAuth().handler(request);
