import { dashboardPage, loginPage } from '../src/admin/admin.view';
import type { Order } from '../src/database/entities/order.entity';

/**
 * Validité syntaxique du JavaScript embarqué dans le dashboard.
 *
 * Le dashboard est du JS écrit à l'intérieur d'un template literal TypeScript.
 * Conséquence peu intuitive : un simple **backtick dans un commentaire JS**
 * ferme la chaîne et casse tout le fichier. C'est arrivé pendant cette série
 * de correctifs — un commentaire mentionnant `r.json()` entre backticks.
 *
 * Le typecheck attrape ce cas précis, mais rien ne couvrait l'inverse : un JS
 * syntaxiquement invalide que TypeScript accepte parce qu'il n'y voit qu'une
 * chaîne de caractères. La page se servait alors normalement, avec un
 * `SyntaxError` dans la console du navigateur et un dashboard entièrement
 * inerte — aucun bouton ne répondant.
 *
 * `new Function(code)` parse sans exécuter : exactement ce qu'il faut.
 */
function blocsScript(html: string): string[] {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function commande(i: number): Order {
  return {
    shopifyOrderId: String(i),
    orderNumber: i,
    customerName: `Client ${i}`,
    customerEmail: 'client@exemple.fr',
    totalPrice: '42.00',
    lineItems: [],
    productionStatus: 'to_produce',
    financialStatus: 'paid',
    receivedAt: new Date(),
    shopifyCreatedAt: new Date(),
  } as unknown as Order;
}

describe('JavaScript embarqué — dashboard', () => {
  const html = dashboardPage([], [], [], 'https://exemple.fr', 'boutique', {
    limits: { orders: 300, quotes: 500 },
  });

  it('expose au moins un bloc script', () => {
    expect(blocsScript(html).length).toBeGreaterThan(0);
  });

  it('ne contient aucune erreur de syntaxe', () => {
    for (const [i, code] of blocsScript(html).entries()) {
      // Échoue avec le message du parseur, qui pointe la ligne fautive.
      expect(() => new Function(code)).not.toThrow();
      expect(typeof i).toBe('number');
    }
  });

  it('reste valide avec des commandes réelles', () => {
    // Les données passent par `esc()` : on vérifie que l'échappement ne
    // produit pas de JS cassé (guillemets, apostrophes, accents).
    const avecDonnees = dashboardPage(
      [commande(1), commande(2)],
      [],
      [],
      'https://exemple.fr',
      'boutique',
      { limits: { orders: 300, quotes: 500 } },
    );
    for (const code of blocsScript(avecDonnees)) {
      expect(() => new Function(code)).not.toThrow();
    }
  });

  it('embarque les gestionnaires corrigés', () => {
    expect(html).toContain('function saveNote');
    expect(html).toContain('function doProdStatus');
  });

  it('vérifie le statut HTTP avant de parser la réponse', () => {
    // Sans ce test, `fetch` traitait une 401 ou une 502 comme un succès et
    // affichait « Erreur réseau » à la place de la vraie cause.
    expect(html).toContain('r.status===401');
  });
});

describe('JavaScript embarqué — page de connexion', () => {
  it('ne contient aucune erreur de syntaxe', () => {
    for (const variante of [loginPage(false), loginPage(true)]) {
      for (const code of blocsScript(variante)) {
        expect(() => new Function(code)).not.toThrow();
      }
    }
  });
});
