import express from 'express';
import helmet from 'helmet';
import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'net';

/**
 * La CSP est une CHAÎNE dans un en-tête HTTP : ni TypeScript ni le linter ne
 * peuvent la vérifier. C'est ce qui a laissé passer une régression où
 * `script-src-attr` valait `'none'` — les 56 gestionnaires `onclick` du
 * dashboard étaient bloqués, la page s'affichait et ne répondait plus à aucun
 * clic, y compris le bouton « Imprimer » des fiches d'atelier.
 *
 * Ces tests lisent l'en-tête RÉELLEMENT émis. Ils doivent reproduire à
 * l'identique la configuration de `src/main.ts` : toute divergence entre les
 * deux doit être considérée comme un bug du test.
 */

/** Réplique exacte de la configuration helmet de `src/main.ts`. */
function buildApp(isProd: boolean) {
  const app = express();
  app.use(
    (
      req: Request & { cspNonce?: string },
      _res: Response,
      next: NextFunction,
    ) => {
      req.cspNonce = randomBytes(16).toString('base64');
      next();
    },
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (req) => `'nonce-${(req as Request & { cspNonce?: string }).cspNonce}'`,
            "'unsafe-inline'",
          ],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: [
            "'self'",
            (req) => `'nonce-${(req as Request & { cspNonce?: string }).cspNonce}'`,
            "'unsafe-inline'",
          ],
          imgSrc: [
            "'self'",
            'data:',
            'https://res.cloudinary.com',
            'https://cdn.shopify.com',
          ],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          ...(isProd ? {} : { upgradeInsecureRequests: null }),
        },
      },
    }),
  );
  app.get('/x', (_req, res) => res.type('html').send('<b>ok</b>'));
  return app;
}

async function cspOf(isProd: boolean): Promise<string> {
  const srv = buildApp(isProd).listen(0);
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const port = (srv.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/x`);
    return res.headers.get('content-security-policy') || '';
  } finally {
    srv.close();
  }
}

describe('Content-Security-Policy', () => {
  it("n'interdit pas les gestionnaires inline (les 56 onclick du dashboard)", async () => {
    const csp = await cspOf(true);
    // `script-src-attr` est PLUS SPÉCIFIQUE que `script-src` : si elle vaut
    // 'none', le 'unsafe-inline' de script-src ne s'y applique pas.
    expect(csp).toContain("script-src-attr 'unsafe-inline'");
    expect(csp).not.toContain("script-src-attr 'none'");
  });

  it('autorise les blocs inline par nonce, et le nonce change à chaque requête', async () => {
    const [a, b] = [await cspOf(true), await cspOf(true)];
    const n = (c: string) => (c.match(/'nonce-([^']+)'/) || [])[1];
    expect(n(a)).toBeTruthy();
    expect(n(a)).not.toBe(n(b));
  });

  it('autorise les images des deux CDN et les data-URL (aperçus de devis)', async () => {
    const csp = await cspOf(true);
    expect(csp).toContain('https://res.cloudinary.com');
    expect(csp).toContain('https://cdn.shopify.com');
    expect(csp).toContain('data:');
  });

  it('verrouille objets, iframes, formulaires et base', async () => {
    const csp = await cspOf(true);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("n'impose pas https hors production (sinon le dashboard local casse)", async () => {
    expect(await cspOf(false)).not.toContain('upgrade-insecure-requests');
    expect(await cspOf(true)).toContain('upgrade-insecure-requests');
  });

  it('émet un nonce sans caractère cassant l’attribut ou la directive', () => {
    for (let i = 0; i < 500; i++) {
      const nonce = randomBytes(16).toString('base64');
      expect(nonce).not.toMatch(/["';,]/);
    }
  });
});
