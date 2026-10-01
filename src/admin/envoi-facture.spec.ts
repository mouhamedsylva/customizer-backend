import { envoiPeutEtrePasse, factureEnvoyeeDepuis, statutErreurShopify } from './envoi-facture';
import { celluleCsv, periodeFichier } from './csv';

describe('envoi de facture : annuler ou non après une erreur', () => {
  it('lit le statut HTTP des erreurs Shopify', () => {
    expect(statutErreurShopify(new Error('Erreur Shopify (422) : Unprocessable. x'))).toBe(422);
    expect(statutErreurShopify(new Error("Shopify n'a pas répondu en 20s : url"))).toBeNull();
  });

  it('un refus net (4xx) permet d’annuler', () => {
    expect(envoiPeutEtrePasse(new Error('Erreur Shopify (404) : Not Found.'))).toBe(false);
    expect(envoiPeutEtrePasse(new Error('Erreur Shopify (422) : invalid email'))).toBe(false);
  });

  it('délai dépassé, réseau ou 5xx : l’e-mail a pu partir', () => {
    expect(envoiPeutEtrePasse(new Error("Shopify n'a pas répondu en 20s : url"))).toBe(true);
    expect(envoiPeutEtrePasse(new TypeError('fetch failed'))).toBe(true);
    expect(envoiPeutEtrePasse(new Error('Erreur Shopify (502) : Bad Gateway.'))).toBe(true);
  });

  it('ne tient pour envoyée qu’une facture partie PENDANT la tentative', () => {
    const debut = new Date('2026-09-30T10:00:00Z');
    expect(factureEnvoyeeDepuis({ invoice_sent_at: '2026-09-30T10:00:05Z' }, debut)).toBe(true);
    // Envoi d'une tentative précédente : ne prouve rien.
    expect(factureEnvoyeeDepuis({ invoice_sent_at: '2026-09-29T08:00:00Z' }, debut)).toBe(false);
    expect(factureEnvoyeeDepuis({ invoice_sent_at: null }, debut)).toBe(false);
    expect(factureEnvoyeeDepuis(null, debut)).toBe(false);
  });
});

describe('export CSV', () => {
  it('neutralise les formules', () => {
    expect(celluleCsv('=HYPERLINK("https://x","Cliquez")')).toBe(
      `"'=HYPERLINK(""https://x"",""Cliquez"")"`,
    );
    expect(celluleCsv('+33 6 12')).toBe(`"'+33 6 12"`);
    expect(celluleCsv('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(celluleCsv('\tcmd')).toBe(`"'\tcmd"`);
  });

  it('laisse les nombres et le texte ordinaire intacts', () => {
    expect(celluleCsv('-12.50')).toBe('"-12.50"');
    expect(celluleCsv(1800)).toBe('"1800"');
    expect(celluleCsv('Dupont')).toBe('"Dupont"');
    expect(celluleCsv(null)).toBe('""');
  });

  it('période sûre pour un nom de fichier', () => {
    expect(periodeFichier('30d')).toBe('30d');
    expect(periodeFichier('x"\r\nSet-Cookie: a')).toBe('xSet-Cookiea');
    expect(periodeFichier(undefined)).toBe('all');
  });
});

describe('envoi de facture : cas limites', () => {
  it('un échec du jeton OAuth (avant tout envoi) permet d’annuler', () => {
    expect(envoiPeutEtrePasse(new Error('Jeton Shopify refusé (HTTP 401) : x'))).toBe(false);
    expect(envoiPeutEtrePasse(new Error('Accès Shopify non configuré : renseignez…'))).toBe(false);
  });

  it('un renvoi rapide n’est pas confirmé par la date du PREMIER envoi', () => {
    const premier = '2026-09-30T10:00:00Z';
    const debut = new Date('2026-09-30T10:01:00Z'); // renvoi 1 min plus tard
    expect(factureEnvoyeeDepuis({ invoice_sent_at: premier }, debut, premier)).toBe(false);
    expect(
      factureEnvoyeeDepuis({ invoice_sent_at: '2026-09-30T10:01:03Z' }, debut, premier),
    ).toBe(true);
  });
});
