/**
 * Corps des requêtes relayées par le BFF, lus avec une limite (ADR 0008) : sans elle, un envoi
 * démesuré serait entièrement chargé en mémoire avant que Django ne le refuse.
 */

/** Photo de 15 Mo au plus (`apps.body.photos.MAX_UPLOAD_BYTES`), plus une marge. */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Octets du corps, ou `null` s'il dépasse `limit` (annoncé ou constaté en lisant). */
export async function readBody(
  request: Request,
  limit: number = MAX_BODY_BYTES,
): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  if (!request.body) return new ArrayBuffer(0);

  // `Content-Length` peut manquer (envoi découpé) ou mentir : on compte en lisant.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}
