import { lireCorpsBorne } from './lecture-bornee';

describe('lireCorpsBorne', () => {
  it('lit un corps sous la limite', async () => {
    const buf = await lireCorpsBorne(new Response(new Uint8Array([1, 2, 3])), 10);
    expect([...buf]).toEqual([1, 2, 3]);
  });

  it('refuse dès l’en-tête Content-Length', async () => {
    const res = new Response('x', { headers: { 'content-length': '999999999' } });
    await expect(lireCorpsBorne(res, 1000)).rejects.toThrow('trop volumineuse');
  });

  it('coupe le flux au-delà de la limite, même sans en-tête', async () => {
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(400));
        c.close();
      },
    });
    await expect(lireCorpsBorne(new Response(flux), 1000)).rejects.toThrow('trop volumineuse');
  });
});
