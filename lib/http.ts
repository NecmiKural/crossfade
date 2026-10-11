/** Reads at most `maxBytes` of a request body, whether or not it declares a Content-Length. */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Capped JSON body: `undefined` for invalid JSON, `null` when the body is too large. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown | null> {
  const text = await readCapped(request, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
