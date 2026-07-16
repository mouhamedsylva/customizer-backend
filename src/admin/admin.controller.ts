import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
  Param,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { SettingsService } from './settings.service';
import { ShopifyService } from '../shared/shopify.service';
import { EmailService } from '../shared/email.service';
import { loginPage, dashboardPage, productionSheetPage } from './admin.view';

// JSZip : construction d'archives en mémoire, API stable et sans streams.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly auth: AdminAuthService,
    private readonly data: AdminService,
    private readonly settings: SettingsService,
    private readonly shopify: ShopifyService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** Vrai si la requête porte un cookie de session valide (signature + TTL). */
  private isAuthed(req: Request): boolean {
    const token = (req.cookies || {})[this.auth.cookieName];
    return this.auth.verifyToken(token);
  }

  /** Admin connecté (identité + rôle), ou null. Lit la BDD : à utiliser quand
   *  on a besoin de savoir QUI agit (gestion des comptes). */
  private async currentAdmin(req: Request) {
    const token = (req.cookies || {})[this.auth.cookieName];
    return this.auth.currentAdmin(token);
  }

  /**
   * GET /api/admin — dashboard (ou login si non authentifié).
   * Filtres/tri passés en query : period, payment, production, sort.
   */
  @Get()
  async home(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.isAuthed(req)) {
      res.type('html').send(loginPage(false));
      return;
    }
    const filters = {
      period: String(req.query.period || 'all'),
      payment: String(req.query.payment || 'all'),
      production: String(req.query.production || 'all'),
      sort: String(req.query.sort || 'date_desc'),
    };

    const [orders, quotes, designs, settings, me] = await Promise.all([
      this.data.getOrders(filters),
      this.data.getQuotes(filters.period),
      this.data.getDesigns(),
      this.settings.get(),
      this.currentAdmin(req),
    ]);
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'https://example.com';
    const shopDomain = this.config.get<string>('SHOPIFY_STORE_URL') || '';
    res
      .type('html')
      .send(
        dashboardPage(orders, quotes, designs, frontendUrl, shopDomain, {
          filters,
          settings,
          me: me || undefined,
        }),
      );
  }

  /** POST /api/admin/login — vérifie e-mail + mot de passe, pose le cookie. */
  @Post('login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
    @Res() res: Response,
  ): Promise<void> {
    const admin = await this.auth.login(email, password);
    if (!admin) {
      res.type('html').status(401).send(loginPage(true));
      return;
    }
    res.cookie(this.auth.cookieName, this.auth.issueToken(admin.id), {
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
      //    invoiceSentAt sert de point de départ aux relances automatiques ;
      //    le compteur repart à zéro (nouveau cycle de relances).
      await this.data.updateQuoteStatus(quoteId, {
        draftStatus: 'invoice_sent',
        totalPrice: draft?.total_price ? String(draft.total_price) : null,
        invoiceSentAt: new Date(),
        remindersSent: 0,
        lastReminderAt: null,
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

    // « Expédiée » n'est pas un statut interne comme les autres : on le
    // répercute dans Shopify, qui envoie alors SON e-mail d'expédition au
    // client. Si Shopify refuse, on n'enregistre PAS le statut — sinon le
    // dashboard afficherait « Expédiée » alors que le client n'a rien reçu.
    if (status === 'shipped') {
      const tracking = String((req.body as any)?.tracking || '').trim();
      const carrier = String((req.body as any)?.carrier || '').trim();
      try {
        const r = await this.shopify.fulfillOrder(orderId, {
          trackingNumber: tracking || undefined,
          trackingCompany: carrier || undefined,
          notifyCustomer: true,
        });
        await this.data.setProductionStatus(orderId, status);
        await this.data.setFulfillment(orderId, {
          fulfillmentStatus: 'fulfilled',
          trackingNumber: tracking || null,
        });
        res.json({
          ok: true,
          status,
          shopify: r.alreadyFulfilled
            ? 'Cette commande était déjà expédiée dans Shopify.'
            : `Expédiée dans Shopify — le client a reçu son e-mail${tracking ? ' avec le suivi' : ''}.`,
        });
      } catch (err) {
        const msg = (err as Error).message;
        // Le scope manquant est l'erreur la plus probable : on l'explicite.
        const hint = /403|scope|permission/i.test(msg)
          ? " Le token Shopify n'a pas le droit d'expédier : ajoutez le scope " +
            'write_merchant_managed_fulfillment_orders (et read_...) dans votre app, ' +
            'puis régénérez SHOPIFY_ACCESS_TOKEN.'
          : '';
        res.status(502).json({
          ok: false,
          error: `Expédition Shopify refusée : ${msg}${hint}`,
        });
      }
      return;
    }

    // « En production » se répercute aussi dans Shopify (« En préparation »),
    // mais SANS e-mail au client : c'est un statut de préparation interne.
    // Un échec ici n'est pas bloquant — le suivi atelier reste la priorité.
    if (status === 'producing') {
      try {
        await this.shopify.markInProgress(orderId);
      } catch (err) {
        this.logger.warn(
          `Mise en préparation Shopify échouée (${orderId}) : ${(err as Error).message}`,
        );
      }
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
    try {
      await this.buildAndSendZip(orderId, res);
    } catch (err) {
      // Remonte l'erreur réelle plutôt qu'un 500 opaque.
      res
        .status(500)
        .type('text')
        .send('ZIP ERROR:\n' + ((err as Error)?.stack || String(err)));
    }
  }

  /** Construit et envoie l'archive des fichiers d'une commande. */
  private async buildAndSendZip(
    orderId: string,
    res: Response,
  ): Promise<void> {
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

    // 2) Construit l'archive EN MÉMOIRE, puis l'envoie d'un bloc.
    const zip = new JSZip();
    const used = new Set<string>();
    for (const f of fetched) {
      // Évite les doublons de nom dans l'archive.
      let name = f.name;
      let n = 2;
      while (used.has(name)) {
        name = f.name.replace(/(\.\w+)$/, `-${n++}$1`);
      }
      used.add(name);
      zip.file(name, f.buf);
    }

    const zipBuffer: Buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
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

  /**
   * GET /api/admin/export.csv — export CSV enrichi.
   * Query :
   *   type=orders|quotes|accounting  (défaut : orders)
   *   period=all|7d|30d|month|quarter|year
   */
  @Get('export.csv')
  async exportCsv(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.isAuthed(req)) {
      res.redirect('/api/admin');
      return;
    }
    const type = String(req.query.type || 'orders');
    const period = String(req.query.period || 'all');
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    let rows: string[] = [];
    let filename = 'export.csv';

    if (type === 'quotes') {
      // ── Devis ──
      filename = `devis-${period}.csv`;
      rows = [
        'reference,client,email,telephone,entreprise,produit,quantite,total,statut,relances,date',
      ];
      const quotes = await this.data.getQuotes(period);
      for (const qt of quotes) {
        const d = (qt.quoteData || {}) as Record<string, any>;
        const c = d.customer || {};
        const coin = d.coin || {};
        rows.push(
          [
            q(qt.id),
            q(c.nom),
            q(c.email),
            q(c.telephone),
            q(c.entreprise),
            q(coin.name),
            q(coin.qty),
            q(qt.totalPrice),
            q(QUOTE_STATUS_FR[qt.draftStatus || 'open'] || qt.draftStatus),
            q(qt.remindersSent ?? 0),
            q(qt.createdAt ? new Date(qt.createdAt).toISOString() : ''),
          ].join(','),
        );
      }
    } else if (type === 'accounting') {
      // ── Export comptable : une ligne par commande payée, montants nets ──
      filename = `comptabilite-${period}.csv`;
      rows = ['date,commande,client,email,total_ttc,devise,statut_paiement'];
      const orders = await this.data.getOrders({ period, payment: 'paid' });
      for (const o of orders) {
        rows.push(
          [
            q(o.shopifyCreatedAt ? new Date(o.shopifyCreatedAt).toISOString().slice(0, 10) : ''),
            q(o.orderNumber || o.shopifyOrderId),
            q(o.customerName),
            q(o.customerEmail),
            q(o.totalPrice),
            q(o.currency || 'EUR'),
            q(o.financialStatus),
          ].join(','),
        );
      }
    } else {
      // ── Commandes (défaut) ──
      filename = `commandes-${period}.csv`;
      rows = [
        'commande,client,email,telephone,total,devise,paiement,production,date,articles,note_interne',
      ];
      const orders = await this.data.getOrders({
        period,
        production: String(req.query.production || 'all'),
        payment: String(req.query.payment || 'all'),
        sort: String(req.query.sort || 'date_desc'),
      });
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
            q(o.customerPhone),
            q(o.totalPrice),
            q(o.currency),
            q(o.financialStatus),
            q(PROD_STATUS_FR[o.productionStatus || 'to_produce'] || o.productionStatus),
            q(o.shopifyCreatedAt ? new Date(o.shopifyCreatedAt).toISOString() : ''),
            q(summary),
            q(o.internalNote),
          ].join(','),
        );
      }
    }

    res.type('text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + rows.join('\n')); // BOM : Excel lit correctement l'UTF-8
  }

  /** POST /api/admin/settings — enregistre les réglages (relances, notifications). */
  @Post('settings')
  async saveSettings(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const days = String(body.reminderDays || '')
      .split(',')
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => Number.isFinite(d) && d > 0);

    const saved = await this.settings.save({
      reminderEnabled: body.reminderEnabled === true || body.reminderEnabled === '1',
      reminderDays: days,
      notifyEmailEnabled:
        body.notifyEmailEnabled === true || body.notifyEmailEnabled === '1',
      notifyEmail: String(body.notifyEmail || ''),
    });
    res.json({ ok: true, settings: saved });
  }

  /**
   * POST /api/admin/settings/test-email — envoie un e-mail de test.
   * Sans cela, on ne sait pas si le SMTP fonctionne avant qu'une vraie
   * commande n'arrive (et l'échec serait alors silencieux).
   */
  @Post('settings/test-email')
  async testEmail(
    @Req() req: Request,
    @Body('email') email: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const to = String(email || '').trim();
    if (!to) {
      res.json({ ok: false, error: "Renseignez d'abord une adresse." });
      return;
    }

    // 1. Le serveur SMTP est-il seulement joignable ?
    const conn = await this.email.verifyConnection();
    if (!conn.success) {
      res.json({
        ok: false,
        error: `SMTP injoignable : ${conn.message}. Vérifiez EMAIL_HOST, EMAIL_PORT, EMAIL_USER et EMAIL_PASSWORD sur Railway.`,
      });
      return;
    }

    // 2. L'envoi passe-t-il vraiment ?
    const sent = await this.email.sendInternalAlert(
      to,
      'Test — alertes Custom Textile',
      [
        'Cet e-mail confirme que les alertes de nouvelle commande fonctionnent.',
        'Vous recevrez désormais un message à chaque nouvelle commande.',
      ],
      `${this.config.get<string>('BACKEND_URL') || ''}/api/admin`,
    );
    res.json(
      sent
        ? { ok: true, to }
        : {
            ok: false,
            error:
              "Le serveur SMTP répond, mais l'envoi a échoué. Consultez les logs Railway.",
          },
    );
  }

  /**
   * GET /api/admin/status — état léger (compteurs) pour l'auto-rafraîchissement.
   * Le dashboard interroge cet endpoint périodiquement et ne se recharge que si
   * les compteurs ont changé (nouvelle commande/devis, etc.).
   */
  @Get('status')
  async status(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const status = await this.data.getStatus();
    res.json({ ok: true, ...status });
  }

  /** POST /api/admin/seen — marque commandes et devis comme vus. */
  @Post('seen')
  async markSeen(
    @Req() req: Request,
    @Body('orders') orderIds: string[],
    @Body('quotes') quoteIds: string[],
    @Res() res: Response,
  ): Promise<void> {
    if (!this.isAuthed(req)) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    await this.data.markOrdersSeen(Array.isArray(orderIds) ? orderIds : []);
    await this.data.markQuotesSeen(Array.isArray(quoteIds) ? quoteIds : []);
    res.json({ ok: true });
  }

  // ────────────────────────── Gestion des admins ──────────────────────────
  // Réservée à l'owner : lister, inviter (e-mail + mot de passe généré),
  // bloquer/débloquer, régénérer un mot de passe.

  /** GET /api/admin/admins — liste des comptes (owner uniquement). */
  @Get('admins')
  async listAdmins(@Req() req: Request, @Res() res: Response): Promise<void> {
    const me = await this.currentAdmin(req);
    if (!me) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    if (me.role !== 'owner') {
      res.status(403).json({ ok: false, error: 'Réservé à l’admin principal.' });
      return;
    }
    const admins = await this.auth.list();
    res.json({
      ok: true,
      me: { id: me.id, email: me.email, role: me.role },
      admins: admins.map((a) => ({
        id: a.id,
        email: a.email,
        role: a.role,
        blocked: a.blocked,
        invitedBy: a.invitedBy,
        shopifyCustomerId: a.shopifyCustomerId,
        lastLoginAt: a.lastLoginAt,
        createdAt: a.createdAt,
      })),
    });
  }

  /**
   * POST /api/admin/admins — invite un admin.
   * Body : { email }. Le mot de passe (8 caractères) est GÉNÉRÉ ici et renvoyé
   * en clair UNE SEULE FOIS, pour que l'owner puisse le partager.
   */
  @Post('admins')
  async inviteAdmin(
    @Req() req: Request,
    @Body('email') email: string,
    @Res() res: Response,
  ): Promise<void> {
    const me = await this.currentAdmin(req);
    if (!me) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    if (me.role !== 'owner') {
      res.status(403).json({ ok: false, error: 'Réservé à l’admin principal.' });
      return;
    }

    const mail = String(email || '').trim().toLowerCase();

    // Validation AVANT tout appel Shopify : inutile de créer un client si
    // l'e-mail est invalide ou déjà utilisé par un admin.
    const check = await this.auth.validateNewEmail(mail);
    if (!check.ok) {
      res.status(400).json({ ok: false, error: check.error });
      return;
    }

    // Rattachement Shopify : on crée (ou retrouve) le customer correspondant.
    // Un échec Shopify NE BLOQUE PAS la création de l'admin : le dashboard doit
    // rester utilisable même si la boutique est injoignable ou mal configurée.
    let customerId: string | null = null;
    let shopifyNote: string | undefined;
    try {
      const cust = await this.shopify.createCustomer({
        email: mail,
        tags: 'admin-dashboard',
        note: `Compte administrateur du dashboard, invité par ${me.email}.`,
      });
      if (cust.ok && cust.customer) {
        customerId = String(cust.customer.id);
        shopifyNote = cust.existed
          ? 'Client Shopify existant rattaché.'
          : 'Client Shopify créé.';
      } else {
        shopifyNote = 'Client Shopify non créé : ' + (cust.error || 'erreur');
      }
    } catch (e) {
      this.logger.warn(
        `Rattachement Shopify impossible pour ${mail} : ${(e as Error).message}`,
      );
      shopifyNote = 'Client Shopify non créé (Shopify injoignable).';
    }

    const password = this.auth.generatePassword(8);
    const result = await this.auth.createAdmin(
      mail,
      password,
      me.email,
      customerId,
    );
    if (!result.ok || !result.admin) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({
      ok: true,
      // Mot de passe en clair : unique occasion de l'afficher/partager.
      password,
      shopify: { customerId, note: shopifyNote },
      admin: {
        id: result.admin.id,
        email: result.admin.email,
        role: result.admin.role,
        blocked: result.admin.blocked,
        shopifyCustomerId: result.admin.shopifyCustomerId,
        createdAt: result.admin.createdAt,
      },
    });
  }

  /** POST /api/admin/admins/:id/blocked — bloque/débloque (owner uniquement). */
  @Post('admins/:id/blocked')
  async blockAdmin(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('blocked') blocked: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const me = await this.currentAdmin(req);
    if (!me) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    if (me.role !== 'owner') {
      res.status(403).json({ ok: false, error: 'Réservé à l’admin principal.' });
      return;
    }
    const result = await this.auth.setBlocked(id, blocked === true, me.id);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true });
  }

  /**
   * POST /api/admin/admins/:id/password — régénère le mot de passe d'un admin.
   * Renvoie le nouveau en clair, pour partage immédiat.
   */
  @Post('admins/:id/password')
  async resetAdminPassword(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const me = await this.currentAdmin(req);
    if (!me) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    if (me.role !== 'owner') {
      res.status(403).json({ ok: false, error: 'Réservé à l’admin principal.' });
      return;
    }
    const result = await this.auth.resetPassword(id);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, password: result.password, email: result.email });
  }
}

/** Libellés français des statuts, pour les exports. */
const PROD_STATUS_FR: Record<string, string> = {
  to_produce: 'À produire',
  producing: 'En production',
  ready: 'Prête',
  shipped: 'Expédiée',
};
const QUOTE_STATUS_FR: Record<string, string> = {
  open: 'À chiffrer',
  invoice_sent: 'Facture envoyée',
  completed: 'Payé',
};
