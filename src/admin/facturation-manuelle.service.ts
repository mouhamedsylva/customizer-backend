/**
 * FACTURATION SHOPIFY DES COMMANDES MANUELLES.
 *
 * Une commande manuelle (id négatif, voir commandes-manuelles.ts) devient un
 * BROUILLON Shopify, comme un devis :
 *   - mode « facture » : le client reçoit l'e-mail de facture Shopify (lien de
 *     paiement). À son paiement, Shopify crée la commande ; elle arrive par le
 *     webhook ou l'import, et `saveOrder` lui transfère fichiers, note et suivi
 *     avant de supprimer la ligne manuelle (webhooks.service.ts) ;
 *   - mode « payee » : paiement déjà reçu (virement, chèque…), le brouillon est
 *     validé comme PAYÉ, sans e-mail de facture.
 *
 * Le suivi est rangé dans `customerInfo.facture` (aucune colonne, aucun SQL) :
 * `saveOrder` ne touche jamais les lignes à identifiant négatif.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { ShopifyService } from '../shared/shopify.service';
import {
  FactureManuelle,
  ModeFacturation,
  brouillonDepuisManuelle,
  estCommandeManuelle,
  factureDe,
} from './commandes-manuelles';

/** Texte de l'e-mail de facture (Shopify y ajoute le détail et le lien de paiement). */
export function messageFactureManuelle(v: { nom: string; numero: string; articles: string[]; total: string }): string {
  return [
    v.nom ? `Bonjour ${v.nom},` : 'Bonjour,',
    '',
    `Merci pour votre commande ${v.numero}. Voici sa facture :`,
    ...v.articles.map((a) => `• ${a}`),
    `Total : ${v.total} TTC.`,
    '',
    'Vous pouvez la régler directement via le lien ci-dessous ; la fabrication est lancée dès réception du paiement.',
    '',
    'Merci de votre confiance.',
    "L'équipe Massacre Officiel",
  ].join('\n');
}

/** Refus métier, avec le statut HTTP à renvoyer. */
export class RefusFacturation extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class FacturationManuelleService {
  private readonly logger = new Logger(FacturationManuelleService.name);
  /* Un envoi à la fois par commande : un double clic créerait deux brouillons
     et deux e-mails. Verrou en mémoire, comme pour les factures de devis. */
  private readonly enCours = new Set<string>();

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly shopify: ShopifyService,
  ) {}

  private async noter(o: Order, facture: FactureManuelle): Promise<void> {
    o.customerInfo = { ...(o.customerInfo || {}), facture };
    await this.orders.update({ shopifyOrderId: o.shopifyOrderId }, { customerInfo: o.customerInfo as any });
  }

  async facturer(
    id: string,
    mode: ModeFacturation,
  ): Promise<{ facture: FactureManuelle; total: string }> {
    if (!estCommandeManuelle(id)) {
      throw new RefusFacturation(403, 'Seules les commandes saisies à la main se facturent ici.');
    }
    if (this.enCours.has(id)) throw new RefusFacturation(409, 'Envoi déjà en cours pour cette commande.');
    this.enCours.add(id);
    try {
      return await this.facturerSansVerrou(id, mode);
    } finally {
      this.enCours.delete(id);
    }
  }

  private async facturerSansVerrou(
    id: string,
    mode: ModeFacturation,
  ): Promise<{ facture: FactureManuelle; total: string }> {
    const o = await this.orders.findOne({ where: { shopifyOrderId: id } });
    if (!o) throw new RefusFacturation(404, 'Commande introuvable.');
    const avant = factureDe(o);
    if (avant && avant.statut !== 'echec') {
      throw new RefusFacturation(
        409,
        avant.statut === 'payee' ? 'Cette commande est déjà validée dans Shopify.' : 'La facture a déjà été envoyée.',
      );
    }
    const total = Number(o.totalPrice);
    if (!(total > 0)) throw new RefusFacturation(400, 'Montant total manquant.');
    if (mode === 'facture' && !o.customerEmail) {
      throw new RefusFacturation(400, "L'e-mail du client est nécessaire pour lui envoyer la facture.");
    }
    const numero = o.orderNumber || id;
    const lignes = Array.isArray(o.lineItems) ? (o.lineItems as any[]) : [];
    const pieces = lignes.reduce((n, li) => n + Math.max(1, Number(li?.quantity) || 1), 0);
    if (!pieces) throw new RefusFacturation(400, 'La commande ne contient aucun article.');

    let draftId = avant?.draftOrderId || '';
    try {
      // 1. Brouillon (réutilisé si une tentative précédente l'a déjà créé).
      if (!draftId) {
        const d = await this.shopify.createDraftOrder(brouillonDepuisManuelle(o) as any);
        draftId = String(d.id);
        // Noté AUSSITÔT : un échec plus loin ne doit pas créer un second brouillon.
        await this.noter(o, { draftOrderId: draftId, statut: 'echec', le: new Date().toISOString(), erreur: 'Envoi interrompu.' });
      }

      // 2. TVA : le montant saisi est TTC. Si la boutique n'inclut pas les
      //    taxes dans ses prix, Shopify les ajouterait par-dessus.
      const brouillon = await this.shopify.getDraftOrder(draftId);
      const taxes = ShopifyService.lireTaxes(brouillon);
      const ttcVersPrix = taxes.taxesIncluded === false && !taxes.taxExempt && taxes.rate ? 1 + taxes.rate : 1;

      // 3. Prix : celui de CHAQUE ligne (prix unitaire saisi à l'étape 2).
      //    Commande antérieure, sans prix par ligne : le total est réparti au
      //    centime sur toutes les lignes, comme avant.
      const prixLignes = lignes.map((li) => Number(li?.price));
      const parLigne = prixLignes.length > 0 && prixLignes.every((p) => p > 0);
      const tarife = parLigne
        ? await this.shopify.updateDraftOrderLineItems(
            draftId,
            brouillonDepuisManuelle(o).line_items.map((li, i) => ({
              ...li,
              price: (prixLignes[i] / ttcVersPrix).toFixed(2),
            })),
          )
        : await this.shopify.setDraftOrderPrice(draftId, total / ttcVersPrix / pieces);
      const totalShopify = Number(tarife?.total_price);
      const tolerance = Math.max(0.02, 0.01 * pieces);
      if (Number.isFinite(totalShopify) && Math.abs(totalShopify - total) > tolerance) {
        throw new RefusFacturation(
          409,
          `Shopify calcule ${totalShopify.toFixed(2)} € au lieu de ${total.toFixed(2)} € (TVA ou arrondi). ` +
            'Rien n’a été envoyé au client : vérifiez le montant, puis réessayez.',
        );
      }
      const totalFinal = Number.isFinite(totalShopify) ? totalShopify.toFixed(2) : total.toFixed(2);

      // 4. Envoi de la facture, ou validation comme payée.
      if (mode === 'facture') {
        /* Message PROPRE aux commandes manuelles : le modèle « invoice » du
           dashboard parle de devis (« Voici votre devis… »), faux ici — la
           commande est conclue, seul le règlement reste à faire. */
        const message = messageFactureManuelle({
          nom: o.customerName || '',
          numero,
          articles: lignes.map((li) => {
            const q = Math.max(1, Number(li?.quantity) || 1);
            const pu = Number(li?.price);
            return `${q} × ${String(li?.title || 'Article')}` + (pu > 0 ? ` (${pu.toFixed(2).replace('.', ',')} € l'unité)` : '');
          }),
          total: `${totalFinal.replace('.', ',')} €`,
        });
        await this.shopify.sendDraftOrderInvoice(draftId, {
          to: o.customerEmail || undefined,
          subject: `Votre commande ${numero}`,
          custom_message: message,
        });
        const facture: FactureManuelle = { draftOrderId: draftId, statut: 'envoyee', le: new Date().toISOString(), total: totalFinal };
        await this.noter(o, facture);
        return { facture, total: totalFinal };
      }

      const valide = await this.shopify.completeDraftOrder(draftId, false);
      const facture: FactureManuelle = {
        draftOrderId: draftId,
        statut: 'payee',
        le: new Date().toISOString(),
        total: totalFinal,
        ...(valide?.order_id ? { orderId: String(valide.order_id) } : {}),
      };
      await this.noter(o, facture);
      return { facture, total: totalFinal };
    } catch (e) {
      const message = (e as Error).message || 'Erreur Shopify.';
      if (draftId || !(e instanceof RefusFacturation)) {
        await this.noter(o, {
          ...(draftId ? { draftOrderId: draftId } : {}),
          statut: 'echec',
          le: new Date().toISOString(),
          erreur: message.slice(0, 300),
        }).catch(() => undefined);
      }
      if (e instanceof RefusFacturation) throw e;
      this.logger.error(`Facturation ${numero} : ${message}`);
      throw new RefusFacturation(502, `Shopify a refusé : ${message}`);
    }
  }
}
