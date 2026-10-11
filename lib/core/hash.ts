import { createHash, timingSafeEqual } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Constant-time secret comparison; hashing first makes the lengths equal. */
export function constantTimeEqual(expected: string, given: string | null | undefined): boolean {
  if (typeof given !== "string") return false;
  return timingSafeEqual(digest(expected), digest(given));
}
