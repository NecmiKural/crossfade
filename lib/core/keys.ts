export const releaseKey = (appKey: string, n: number): string => `${appKey}-R${n}`;
export const incidentKey = (appKey: string, n: number): string => `${appKey}-${n}`;

export type ParsedKey = Readonly<{ appKey: string; kind: "release" | "incident"; number: number }>;

const KEY_RE = /^([A-Z][A-Z0-9]{1,9})-(R?)([1-9][0-9]{0,8})$/;

/** Parses SHOP-R7 (release) or SHOP-14 (incident). */
export function parseKey(key: string): ParsedKey | null {
  const match = KEY_RE.exec(key);
  if (!match) return null;
  return { appKey: match[1], kind: match[2] === "R" ? "release" : "incident", number: Number(match[3]) };
}
