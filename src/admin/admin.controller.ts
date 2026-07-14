import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
  Param,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as archiverLib from 'archiver';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { ShopifyService } from '../shared/shopify.service';
import { loginPage, dashboardPage, productionSheetPage } from './admin.view';

// `archiver` s'utilise comme une fonction ; le typage CJS l'expose en namespace.
const archiver = archiverLib as unknown as (
  format: string,
  opts?: Record<string, unknown>,
) => any;

@Controller('admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly data: AdminService,
    private readonly shopify: ShopifyService,
    private readonly config: ConfigService,
  ) {}

  /** Vrai si la requête porte un cookie de session valide. */
  private isAuthed(req: Request): boolean {
    const token = (req.cookies || {})[this.auth.cookieName];
    return this.auth.verifyToken(token);
  }

  /** GET /api/admin — dashboard (ou login si non authentifié). */
  @Get()
  async home(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.isAuthed(req)) {
      res.type('html').send(loginPage(false));
      return;
    }
    const [orders, quotes, designs] = await Promise.all([
      this.data.getOrders(),
      this.data.getQuotes(),
      this.data.getDesigns(),
    ]);
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://example.com';
    const shopDomain = this.config.get<string>('SHOPIFY_STORE_URL') || '';
    res
      .type('html')
      .send(dashboardPage(orders, quotes, designs, frontendUrl, shopDomain));
  }

  /** POST /api/admin/login — vérifie le mot de passe, pose le cookie. */
  @Post('login')
  login(
    @Body('password') password: string,
    @Res() res: Response,
  ): void {
    if (!this.auth.checkPassword(password)) {
      res.type('html').status(401).send(loginPage(true));
      return;
    }
    res.cookie(this.auth.cookieName, this.auth.issueToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 1000 * 60 * 60 * 12,
    });
    res.redirect('/api/admin');
  }

  /** GET /api/admin/logout — supprime le cookie. */
  @Get('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(this.auth.cookieName);
    res.redirect('/api/admin');
  }

  /**
   * POST /api/admin/quotes/:id/invoice — définit le prix puis envoie la facture.
   * Body : { unitPrice: number, message?: string }
   * Le prix unitaire est appliqué à la ligne du brouillon Shopify (le total est
   * recalculé par Shopify), puis le client reçoit l'e-mail de facture avec un
   * lien de paiement. Tout se fait sans quitter le dashboard.
   */
  @Post('quotes/:id/invoice')
  async sendQuoteInvoice(
    @Req() req: Request,
    @Param('id') quoteId: string,
    @Body('message') message: string,
    @Body('unitPrice') unitPrice: unknown,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }

    const quote = await this.data.getQuote(quoteId);
    if (!quote) {
      res.status(404).json({ ok: false, error: 'Devis introuvable.' });
      return;
    }
    if (!quote.draftOrderId) {
      res.status(400).json({
        ok: false,
        error:
          "Ce devis n'a pas de brouillon Shopify associé : impossible d'envoyer la facture.",
      });
      return;
    }

    const price = Number(unitPrice);
    if (!Number.isFinite(price) || price <= 0) {
      res.status(400).json({
        ok: false,
        error: 'Indiquez un prix unitaire supérieur à 0.',
      });
      return;
    }

    const data = (quote.quoteData || {}) as Record<string, any>;
    const customer = data.customer || {};
    const productName = data.coin?.name || 'votre commande personnalisée';

    try {
      // 1) Applique le prix à la ligne du brouillon (total recalculé par Shopify).
      const draft = await this.shopify.setDraftOrderPrice(
        quote.draftOrderId,
        price,
      );

      // 2) Envoie la facture au client.
      await this.shopify.sendDraftOrderInvoice(quote.draftOrderId, {
        to: customer.email,
        subject: `Votre devis — ${productName}`,
        custom_message:
          (message || '').trim() ||
          `Bonjour ${customer.nom || ''},\n\n` +
            `Voici votre devis pour ${productName}. ` +
            `Vous pouvez le régler directement via le lien ci-dessous.\n\n` +
            `Merci de votre confiance.\nL'équipe Custom Textile`,
      });

      // 3) Reflète immédiatement l'état « facture envoyée » dans le dashboard.
      await this.data.updateQuoteStatus(quoteId, {
        draftStatus: 'invoice_sent',
        totalPrice: draft?.total_price ? String(draft.total_price) : null,
      });

      res.json({
        ok: true,
        to: customer.email,
        total: draft?.total_price ?? null,
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: (err as Error).message });
    }
  }

  /**
   * POST /api/admin/orders/:id/status — change le statut de production.
   * Body : { status: 'to_produce' | 'producing' | 'ready' | 'shipped' }
   */
  @Post('orders/:id/status')
  async setOrderStatus(
    @Req() req: Request,
    @Param('id') orderId: string,
    @Body('status') status: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const allowed = ['to_produce', 'producing', 'ready', 'shipped'];
    if (!allowed.includes(status)) {
      res.status(400).json({ ok: false, error: 'Statut inconnu.' });
      return;
    }
    await this.data.setProductionStatus(orderId, status);
    res.json({ ok: true, status });
  }

  /** POST /api/admin/orders/:id/note — enregistre la note interne. */
  @Post('orders/:id/note')
  async setOrderNote(
    @Req() req: Request,
    @Param('id') orderId: string,
    @Body('note') note: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    await this.data.setInternalNote(orderId, (note || '').slice(0, 2000));
    res.json({ ok: true });
  }

  /**
   * GET /api/admin/orders/:id/sheet — fiche de production imprimable (A4).
   * Page autonome, pensée pour l'atelier : design en grand + specs + client.
   */
  @Get('orders/:id/sheet')
  async productionSheet(
    @Req() req: Request,
    @Param('id') orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.redirect('/api/admin');
      return;
    }
    const order = await this.data.getOrder(orderId);
    if (!order) {
      res.status(404).type('text').send('Commande introuvable.');
      return;
    }
    res.type('html').send(productionSheetPage(order));
  }

  /**
   * GET /api/admin/orders/:id/assets.zip — tous les fichiers de la commande,
   * regroupés dans une archive (logos + aperçus), prêts pour la production.
   */
  @Get('orders/:id/assets.zip')
  async downloadAssets(
    @Req() req: Request,
    @Param('id') orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.redirect('/api/admin');
      return;
    }
    const order = await this.data.getOrder(orderId);
    if (!order) {
      res.status(404).type('text').send('Commande introuvable.');
      return;
    }

    // Collecte toutes les URLs de fichiers portées par les lignes de commande.
    const files: Array<{ name: string; url: string }> = [];
    const items = Array.isArray(order.lineItems) ? order.lineItems : [];
    items.forEach((li: any, i: number) => {
      const props: Array<{ name: string; value: string }> = Array.isArray(
        li.properties,
      )
        ? li.properties
        : [];
      props.forEach((p) => {
        if (typeof p.value !== 'string' || !/^https?:\/\//i.test(p.value)) return;
        const label = String(p.name || 'fichier').replace(/^_/, '');
        const ext = (p.value.split('?')[0].match(/\.(\w{3,4})$/) || [
          '',
          'png',
        ])[1];
        const safe = `${i + 1}-${label}`
          .replace(/[^\w\-. ]+/g, '_')
          .slice(0, 60);
        files.push({ name: `${safe}.${ext}`, url: p.value });
      });
    });

    const label = String(order.orderNumber || order.shopifyOrderId).replace(
      '#',
      '',
    );

    if (!files.length) {
      res
        .status(404)
        .type('text')
        .send('Aucun fichier à télécharger pour cette commande.');
      return;
    }

    // 1) Télécharge d'abord TOUS les fichiers (les URLs Cloudinary peuvent être
    //    lentes). On ignore ceux qui échouent plutôt que de casser l'archive.
    const fetched: Array<{ name: string; buf: Buffer }> = [];
    await Promise.all(
      files.map(async (f) => {
        try {
          const r = await fetch(f.url);
          if (!r.ok) return;
          fetched.push({ name: f.name, buf: Buffer.from(await r.arrayBuffer()) });
        } catch {
          /* fichier inaccessible : ignoré */
        }
      }),
    );

    if (!fetched.length) {
      res
        .status(502)
        .type('text')
        .send('Aucun fichier n’a pu être téléchargé (liens expirés ?).');
      return;
    }

    // 2) Construit l'archive EN MÉMOIRE, puis l'envoie d'un bloc : plus fiable
    //    qu'un pipe direct vers la réponse (pas de course entre flux et await).
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    const zipBuffer: Buffer = await new Promise((resolve, reject) => {
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      // Évite les doublons de nom dans l'archive.
      const used = new Set<string>();
      for (const f of fetched) {
        let name = f.name;
        let n = 2;
        while (used.has(name)) {
          name = f.name.replace(/(\.\w+)$/, `-${n++}$1`);
        }
        used.add(name);
        archive.append(f.buf, { name });
      }
      void archive.finalize();
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="commande-${label}.zip"`,
    );
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.end(zipBuffer);
  }

  /**
   * POST /api/admin/quotes/:id/remind — relance un devis facturé mais impayé.
   * Renvoie la facture Shopify avec un message de relance.
   */
  @Post('quotes/:id/remind')
  async remindQuote(
    @Req() req: Request,
    @Param('id') quoteId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const quote = await this.data.getQuote(quoteId);
    if (!quote?.draftOrderId) {
      res.status(404).json({ ok: false, error: 'Devis introuvable.' });
      return;
    }

    const data = (quote.quoteData || {}) as Record<string, any>;
    const customer = data.customer || {};
    const productName = data.coin?.name || 'votre commande personnalisée';

    try {
      await this.shopify.sendDraftOrderInvoice(quote.draftOrderId, {
        to: customer.email,
        subject: `Relance — votre devis ${productName}`,
        custom_message:
          `Bonjour ${customer.nom || ''},\n\n` +
          `Nous revenons vers vous au sujet de votre devis pour ${productName}, ` +
          `qui reste en attente de règlement.\n\n` +
          `Vous pouvez le régler directement via le lien ci-dessous. ` +
          `N'hésitez pas à nous écrire si vous avez la moindre question.\n\n` +
          `Bien cordialement,\nL'équipe Custom Textile`,
      });
      res.json({ ok: true, to: customer.email });
    } catch (err) {
      res.status(502).json({ ok: false, error: (err as Error).message });
    }
  }

  /** GET /api/admin/export.csv — export CSV des commandes. */
  @Get('export.csv')
  async exportCsv(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.isAuthed(req)) {
      res.redirect('/api/admin');
      return;
    }
    const orders = await this.data.getOrders();
    const rows: string[] = [
      'commande,client,email,total,devise,statut,date,articles',
    ];
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    for (const o of orders) {
      const items = Array.isArray(o.lineItems) ? o.lineItems : [];
      const summary = items
        .map((li: any) => `${li.title} x${li.quantity}`)
        .join(' | ');
      rows.push(
        [
          q(o.orderNumber || o.shopifyOrderId),
          q(o.customerName),
          q(o.customerEmail),
          q(o.totalPrice),
          q(o.currency),
          q(o.financialStatus),
          q(o.shopifyCreatedAt ? new Date(o.shopifyCreatedAt).toISOString() : ''),
          q(summary),
        ].join(','),
      );
    }
    res.type('text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="commandes.csv"');
    res.send('﻿' + rows.join('\n')); // BOM pour Excel
  }
}
