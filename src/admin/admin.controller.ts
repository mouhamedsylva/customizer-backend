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
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { ShopifyService } from '../shared/shopify.service';
import { loginPage, dashboardPage } from './admin.view';

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
   * POST /api/admin/quotes/:id/invoice — envoie la facture d'un devis au client.
   * Utilise le draft order Shopify créé lors de la demande de devis : le client
   * reçoit un e-mail avec le récapitulatif et un lien de paiement.
   * Le montant doit avoir été défini au préalable dans le brouillon Shopify.
   */
  @Post('quotes/:id/invoice')
  async sendQuoteInvoice(
    @Req() req: Request,
    @Param('id') quoteId: string,
    @Body('message') message: string,
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

    const data = (quote.quoteData || {}) as Record<string, any>;
    const customer = data.customer || {};
    const productName = data.coin?.name || 'votre commande personnalisée';

    try {
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
