/**
 * TEST RÉEL du stockage OVHcloud, AVANT la bascule.
 *
 *   docker compose exec api node dist/scripts/tester-stockage-ovh.js
 *
 * Passe par CloudinaryService comme l'application, en forçant OVH quel que soit
 * STOCKAGE_FOURNISSEUR (la production reste sur Cloudinary pendant le test) :
 *   1. envoie un PNG (logo), un SVG (découpe) et un PDF (pièce jointe) ;
 *   2. vérifie que chacun est lisible publiquement (200), avec le bon type et
 *      l'en-tête CORS pour massacre-officiel.com ;
 *   3. relit le PDF par l'API (téléchargement du ZIP de production) ;
 *   4. supprime les trois fichiers et vérifie qu'ils ne sont plus servis.
 * Rien n'est écrit en base. Code de sortie 1 au premier échec.
 */
import 'reflect-metadata';
import sharp from 'sharp';
import { CloudinaryService } from '../shared/cloudinary.service';

const ORIGINE = 'https://massacre-officiel.com';
let echecs = 0;

function verdict(ok: boolean, texte: string): void {
  console.log(`${ok ? '✅' : '❌'} ${texte}`);
  if (!ok) echecs++;
}

async function verifierPublic(nom: string, url: string, type: string): Promise<void> {
  const r = await fetch(url, { headers: { Origin: ORIGINE }, signal: AbortSignal.timeout(15000) });
  verdict(r.status === 200, `${nom} lisible publiquement (HTTP ${r.status})`);
  const ct = r.headers.get('content-type') || '';
  verdict(ct.startsWith(type), `${nom} servi en ${ct || '(aucun type)'}`);
  const cors = r.headers.get('access-control-allow-origin') || '';
  verdict(cors === ORIGINE || cors === '*', `${nom} : CORS ${cors || '(absent — règle CORS du bucket ?)'}`);
}

async function main(): Promise<void> {
  const env = (k: string) => (k === 'STOCKAGE_FOURNISSEUR' ? 'ovh' : process.env[k]);
  const stockage = new CloudinaryService({ get: env } as any);
  console.log(`Bucket ${process.env.OVH_S3_BUCKET} — ${process.env.OVH_S3_URL_PUBLIQUE}\n`);

  const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#c2410c' } }).png().toBuffer();
  const logo = await stockage.uploadLogo(png, 'test', 'front');
  console.log(`   PNG : ${logo.url}`);
  const svg = await stockage.uploadTextSvgVector(
    '<svg width="100" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="20"/></svg>',
    'test',
    'front',
  );
  console.log(`   SVG : ${svg.url}`);
  const pdfOctets = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const pdf = await stockage.uploadQuoteAttachment(pdfOctets, 'test-stockage.pdf', 'application/pdf');
  console.log(`   PDF : ${pdf.url}\n`);

  await verifierPublic('PNG', logo.url, 'image/png');
  await verifierPublic('SVG', svg.url, 'image/svg+xml');
  await verifierPublic('PDF', pdf.url, 'application/pdf');

  const relu = await stockage.telechargerFichier(pdf.publicId, 'raw');
  verdict(relu.equals(pdfOctets), `PDF relu par l'API (${relu.length} octets)`);

  for (const [nom, f] of [['PNG', logo], ['SVG', svg], ['PDF', pdf]] as const) {
    await stockage.deleteResource(f.publicId);
    const r = await fetch(f.url, { signal: AbortSignal.timeout(15000) });
    verdict(r.status === 403 || r.status === 404, `${nom} supprimé (HTTP ${r.status} après suppression)`);
  }

  console.log(echecs ? `\n${echecs} échec(s) : NE PAS basculer.` : '\nTout est vert : la bascule peut se faire.');
  process.exit(echecs ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Erreur :', (e as Error).message);
    process.exit(1);
  });
}
