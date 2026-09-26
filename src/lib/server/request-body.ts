/** Gövde okunamadığında kullanıcıya gösterilecek, durum kodlu hata. */
export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * JSON gövdesini boyut sınırıyla okur. Sınır okunmadan önce de (bildirilen
 * uzunluk) okurken de uygulanıyor: devasa bir gövde belleğe alınmıyor.
 */
export async function readJsonBody(request: Request, maxBytes: number, tooLarge: string): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new RequestError(tooLarge, 413);
  if (!request.body) throw new RequestError("The request body is empty.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestError(tooLarge, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new RequestError("The request body is not valid JSON.", 400);
  }
}
