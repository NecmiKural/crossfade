import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { heartbeats } from "@/lib/db/schema";
import { errorMessage, log } from "@/lib/log";

export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`SELECT 1`);
    const [beat] = await getDb().select().from(heartbeats).where(eq(heartbeats.name, "engine"));
    const lastTickSecondsAgo = beat ? Math.round((Date.now() - beat.at.getTime()) / 1000) : null;
    return Response.json({ db: "ok", engine: { lastTickSecondsAgo } });
  } catch (error) {
    log("warn", "health check failed", { error: errorMessage(error) });
    return Response.json({ db: "unavailable" }, { status: 503 });
  }
}
