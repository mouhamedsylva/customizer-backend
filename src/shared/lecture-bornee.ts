/**
 * Lit le corps d'une réponse `fetch` en s'arrêtant au-delà de `max` octets.
 *
 * `res.arrayBuffer()` chargeait TOUT en mémoire : les routes publiques
 * /api/export/preview-* téléchargent jusqu'à 8 × 21 images, et un fichier
 * de 1 Go hébergé sur un CDN autorisé suffisait à épuiser la mémoire.
 * `Content-Length` est contrôlé d'abord (refus immédiat), puis le flux est
 * compté au fil de l'eau — l'en-tête peut mentir ou manquer.
 */
export async function lireCorpsBorne(res: Response, max: number): Promise<Buffer> {
  const annonce = Number(res.headers.get('content-length'));
  if (Number.isFinite(annonce) && annonce > max) {
    throw new Error('Image trop volumineuse.');
  }
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Image trop volumineuse.');
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux, total);
}
