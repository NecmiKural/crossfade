import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { errorMessage, log } from "@/lib/log";

export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return Response.json({ db: "ok" });
  } catch (error) {
    log("warn", "health check failed", { error: errorMessage(error) });
    return Response.json({ db: "unavailable" }, { status: 503 });
  }
}
