import { PLAN_IDS, PLANS } from "@/lib/core/plans";
import { releaseRequestJsonSchema } from "@/lib/core/schemas";

/** The plan catalog, Open Service Broker style: what CI may ask for, plus the request schema. */
export function GET(): Response {
  return Response.json({
    plans: PLAN_IDS.map((id) => PLANS[id]),
    schemas: { releaseRequest: releaseRequestJsonSchema() },
  });
}
