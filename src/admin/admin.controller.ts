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
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminService, ORDERS_LIMIT, QUOTES_LIMIT } from './admin.service';
import { SettingsService } from './settings.service';
import {
  PricingService,
  PRODUCT_KEYS,
  PRODUCT_LABELS,
  PRODUCT_SHOPIFY_IDS,
  MULTI_VARIANT_KEYS,
  QUOTE_ONLY_KEYS,
} from './pricing.service';
import { ShopifyService } from '../shared/shopify.service';
import {
  loginPage,
  dashboardPage,
  productionSheetPage,
  groupSheetPage,
} from './admin.view';

// JSZip : construction d'archives en mémoire, API stable et sans streams.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');

/**
 * Attributs du cookie de session, PARTAGÉS entre la pose et la suppression.
 *
 * Un navigateur ne supprime un cookie que si le `Set-Cookie` d'effacement
 * porte les mêmes attributs que celui qui l'a posé. `clearCookie` était appelé
 * sans options alors que la pose utilisait `httpOnly`, `sameSite` et
 * `secure` : selon le navigateur, « Se déconnecter » pouvait laisser le cookie
 * en place — l'utilisateur se croyait déconnecté sans l'être.
 *
 * `maxAge` n'est pas ici : il ne concerne que la pose (Express le remplace par
 * une date passée à l'effacement).
 */
const ADMIN_COOKIE = {
  httpOnly: true,
  // `strict` et non `lax` : le dashboard est servi par cette même origine
  // (`GET /api/admin`), aucune navigation cross-site légitime n'a besoin du
  // cookie. En `lax`, un formulaire HTML hébergé ailleurs pouvait déclencher
  // les POST d'administration — changer les prix, envoyer une facture, ou
  // marquer une commande expédiée, ce qui envoie un e-mail au client.
  sameSite: 'strict',
  secure: true,
  path: '/',
} as const;

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly auth: AdminAuthService,
    private readonly data: AdminService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly shopify: ShopifyService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Vrai si la requête porte une session VALIDE et un compte encore actif.
   *
   * On consulte la BDD (via currentAdmin) plutôt que de se fier à la seule
   * signature du cookie : sinon un admin bloqué garderait l'accès jusqu'à
   * l'expiration de son cookie (12 h). Le blocage doit être immédiat.
   */
  private async isAuthed(req: Request): Promise<boolean> {
    return (await this.currentAdmin(req)) !== null;
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
    if (!(await this.isAuthed(req))) {
      // Cookie signé mais compte bloqué/supprimé : on le dit clairement, sinon
      // l'utilisateur croit à un bug de session. Et on purge le cookie devenu
      // inutile pour éviter une boucle de redirection.
      const hadSession = this.auth.verifyToken(
        (req.cookies || {})[this.auth.cookieName],
      );
      if (hadSession) res.clearCookie(this.auth.cookieName, ADMIN_COOKIE);
      res
        .type('html')
        .send(loginPage(false, hadSession ? 'blocked' : undefined, nonceOf(req)));
      return;
    }
    const filters = {
      period: String(req.query.period || 'all'),
      payment: String(req.query.payment || 'all'),
      production: String(req.query.production || 'all'),
      sort: String(req.query.sort || 'date_desc'),
    };

    const [orders, quotes, allQuotes, designs, me] = await Promise.all([
      this.data.getOrders(filters),
      // Dashboard : un devis payé est devenu une commande, il n'a plus sa
      // place dans la liste des devis (il figure dans l'onglet Commandes).
      this.data.getQuotes(filters.period, false),
      // Tous les devis, payés compris : sert à rattacher une commande de groupe
      // à son devis d'origine (liste des personnes) sur la carte commande.
      this.data.getQuotes(filters.period, true),
      this.data.getDesigns(),
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
          me: me || undefined,
          allQuotes,
          nonce: nonceOf(req),
          // Permet à la vue de signaler une liste tronquée : sans cela, les
          // commandes au-delà du plafond étaient inatteignables ET invisibles.
          limits: { orders: ORDERS_LIMIT, quotes: QUOTES_LIMIT },
        }),
      );
  }

  /** POST /api/admin/login — vérifie e-mail + mot de passe, pose le cookie. */
  // Plafond strict : 5 tentatives/minute/IP. Le hachage scrypt est déjà lent
  // (~50 ms), mais ceci bloque net le bruteforce en ligne.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Req() req: Request,
    @Body('email') email: string,
    @Body('password') password: string,
    @Res() res: Response,
  ): Promise<void> {
    const admin = await this.auth.login(email, password);
    if (!admin) {
      res.type('html').status(401).send(loginPage(true, undefined, nonceOf(req)));
      return;
    }
    res.cookie(this.auth.cookieName, this.auth.issueToken(admin.id), {
      ...ADMIN_COOKIE,
      maxAge: 1000 * 60 * 60 * 12,
    });
    res.redirect('/api/admin');
  }

  /** GET /api/admin/logout — supprime le cookie. */
  @Get('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(this.auth.cookieName, ADMIN_COOKIE);
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
    if (!(await this.isAuthed(req))) {
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

    // Un devis PAYÉ ne se refacture pas.
    //
    // Sans cette garde, recliquer « envoyer la facture » réécrivait
    // `draftStatus: 'invoice_sent'` et remettait `remindersSent` à zéro : le
    // client qui venait de régler entrait à nouveau dans le cycle de relances
    // et recevait « votre devis reste en attente de règlement » à J+3, J+7 et
    // J+14. Shopify refuse généralement de modifier un brouillon complété, mais
    // l'écriture en base, elle, avait déjà eu lieu.
    if (quote.draftStatus === 'completed') {
      res.status(409).json({
        ok: false,
        error:
          'Ce devis a déjà été réglé par le client : il ne peut plus être refacturé.',
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
    if (!(await this.isAuthed(req))) {
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

      // Le suivi est persisté AVANT l'appel Shopify. C'est la seule donnée de
      // cette séquence que l'opérateur a saisie à la main et qu'on ne peut pas
      // retrouver ailleurs : une interruption après l'expédition la perdait
      // définitivement (la synchro ne réécrit jamais ce champ, et Shopify
      // refuse de rejouer une commande déjà traitée).
      if (tracking) {
        await this.data
          .setTrackingNumber(orderId, tracking)
          .catch(() => undefined);
      }

      try {
        const r = await this.shopify.fulfillOrder(orderId, {
          trackingNumber: tracking || undefined,
          trackingCompany: carrier || undefined,
          notifyCustomer: true,
        });

        // Relit l'état réel plutôt que d'écrire 'fulfilled' en dur : quand une
        // commande a plusieurs fulfillment orders et qu'un seul reste ouvert,
        // Shopify la considère « partiellement traitée ». La valeur en dur
        // affichait « Traitée » pour une commande à moitié expédiée, et rien
        // ne la corrigeait ensuite (alignOne n'écrit plus cette colonne).
        let real: string | null = 'fulfilled';
        try {
          const state = await this.shopify.getShippingState(orderId);
          real = state === 'fulfilled' ? 'fulfilled' : state === 'partial' ? 'partial' : null;
        } catch {
          // Relecture impossible : on garde 'fulfilled', la synchro corrigera.
        }

        // UNE seule écriture : statut de production et statut d'exécution
        // décrivent le même événement. Les séparer laissait une fenêtre où le
        // dashboard annonçait « Expédiée » et « Non traitée » en même temps.
        await this.data.setShipped(orderId, {
          productionStatus: status,
          fulfillmentStatus: real,
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

    // Retour en arrière vers « À produire » : Shopify n'a AUCUNE opération
    // inverse de `markInProgress` — un fulfillment order passé `IN_PROGRESS`
    // ne revient pas à `OPEN`. La synchro (toutes les 2 min) relit donc
    // `in_progress` et, via fromShopify(), réécrit « En production » : la
    // correction de l'opérateur disparaissait sans le moindre message.
    //
    // On ne peut pas empêcher ce retour ; on le DIT, pour que l'opérateur
    // sache que seul Shopify fait foi sur ce point.
    let notice: string | undefined;
    if (status === 'to_produce') {
      try {
        const state = await this.shopify.getShippingState(orderId);
        if (state === 'in_progress' || state === 'partial') {
          notice =
            'Shopify garde cette commande « en préparation » et ne permet pas ' +
            "de revenir en arrière : le statut repassera à « En production » " +
            'à la prochaine synchronisation.';
        }
      } catch {
        // Relecture impossible : pas d'avertissement plutôt qu'un faux.
      }
    }

    res.json({ ok: true, status, ...(notice ? { notice } : {}) });
  }

  /** POST /api/admin/orders/:id/note — enregistre la note interne. */
  @Post('orders/:id/note')
  async setOrderNote(
    @Req() req: Request,
    @Param('id') orderId: string,
    @Body('note') note: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.isAuthed(req))) {
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
    if (!(await this.isAuthed(req))) {
      res.redirect('/api/admin');
      return;
    }
    const order = await this.data.getOrder(orderId);
    if (!order) {
      res.status(404).type('text').send('Commande introuvable.');
      return;
    }
    res.type('html').send(productionSheetPage(order, nonceOf(req)));
  }

  /**
   * GET /api/admin/quotes/:id/sheet — fiche de production d'une commande de
   * GROUPE (le devis n'est pas encore une commande payée). Design commun +
   * récap taille/couleur + liste des flocages, imprimable A4.
   */
  @Get('quotes/:id/sheet')
  async groupSheet(
    @Req() req: Request,
    @Param('id') quoteId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.isAuthed(req))) {
      res.redirect('/api/admin');
      return;
    }
    const quote = await this.data.getQuote(quoteId);
    if (!quote) {
      res.status(404).type('text').send('Devis introuvable.');
      return;
    }
    res.type('html').send(groupSheetPage(quote, nonceOf(req)));
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
    if (!(await this.isAuthed(req))) {
      res.redirect('/api/admin');
      return;
    }
    try {
      await this.buildAndSendZip(orderId, res);
    } catch (err) {
      // Le DÉTAIL part dans les logs, pas dans la réponse : la stack trace
      // exposait les chemins absolus du serveur, la structure interne et les
      // versions des bibliothèques.
      this.logger.error(
        `Archive de la commande ${orderId} impossible : ` +
          ((err as Error)?.stack || String(err)),
      );
      if (!res.headersSent) {
        res
          .status(500)
          .type('text')
          .send(
            "L'archive n'a pas pu être construite. " +
              'Le détail figure dans les logs du serveur.',
          );
      }
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

    // 1) Télécharge les fichiers, PAR LOTS et avec timeout. On ignore ceux qui
    //    échouent plutôt que de casser l'archive.
    //
    //    Trois garde-fous, absents jusqu'ici :
    //      - liste blanche d'hôtes : ces URLs viennent des `properties` des
    //        lignes de commande, que le client remplit librement via le panier.
    //        Sans filtre, une commande pouvait faire interroger au serveur une
    //        adresse interne (métadonnées cloud, service local) dont le contenu
    //        atterrissait dans l'archive téléchargée par l'admin ;
    //      - timeout : `fetch` n'en a aucun par défaut, une URL qui pend
    //        bloquait la requête admin indéfiniment ;
    //      - parallélisme borné : une commande de 50 lignes déclenchait 200
    //        téléchargements simultanés, tous conservés en mémoire.
    const fetched: Array<{ name: string; buf: Buffer }> = [];
    const allowed = files.filter((f) => isAllowedAssetUrl(f.url));
    const skipped = files.length - allowed.length;
    if (skipped > 0) {
      this.logger.warn(
        `Archive ${orderId} : ${skipped} fichier(s) ignoré(s), hôte non autorisé.`,
      );
    }

    const BATCH = 5;
    for (let i = 0; i < allowed.length; i += BATCH) {
      await Promise.all(
        allowed.slice(i, i + BATCH).map(async (f) => {
          try {
            const r = await fetch(f.url, {
              redirect: 'manual',
              signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) return;
            fetched.push({
              name: f.name,
              buf: Buffer.from(await r.arrayBuffer()),
            });
          } catch {
            /* fichier inaccessible : ignoré */
          }
        }),
      );
    }

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
    if (!(await this.isAuthed(req))) {
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

      // Compte la relance manuelle comme une relance à part entière.
      //
      // Sans ça, le cron horaire voyait `lastReminderAt` toujours nul, sautait
      // son garde-fou anti-doublon et pouvait renvoyer le MÊME message une
      // heure plus tard — deux e-mails au libellé identique chez le client.
      await this.data.updateQuoteStatus(quoteId, {
        remindersSent: (quote.remindersSent || 0) + 1,
        lastReminderAt: new Date(),
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
    if (!(await this.isAuthed(req))) {
      res.redirect('/api/admin');
      return;
    }
    const type = String(req.query.type || 'orders');
    const period = String(req.query.period || 'all');
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    /**
     * Plafond des exports.
     *
     * Les listes du dashboard sont bornées à 300 (commandes) et 500 (devis)
     * pour rester légères à l'affichage. L'export héritait de ces plafonds
     * SANS le dire : au-delà, le CSV comptable perdait silencieusement les
     * lignes les plus anciennes de la période — un exercice incomplet remis
     * au comptable sans le moindre signal.
     */
    // PLAFOND TECHNIQUE, pas seulement fonctionnel : `getOrders`/`getQuotes`
    // chargent les lignes via `In(ids)`, ce qui produit un placeholder par id.
    // MySQL en accepte 65 535 au maximum par requête préparée. 50 000 laisse
    // une marge volontaire — ne PAS augmenter cette valeur sans passer la
    // lecture en pagination, sinon l'export échouerait pile au moment de la
    // clôture comptable annuelle.
    const EXPORT_LIMIT = 50000;

    let rows: string[] = [];
    let filename = 'export.csv';
    let truncated = false;

    if (type === 'quotes') {
      // ── Devis ──
      filename = `devis-${period}.csv`;
      rows = [
        'reference,client,email,telephone,entreprise,produit,quantite,total,statut,relances,date',
      ];
      const quotes = await this.data.getQuotes(period, true, EXPORT_LIMIT);
      truncated = quotes.length >= EXPORT_LIMIT;
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
      const orders = await this.data.getOrders({
        period,
        payment: 'paid',
        limit: EXPORT_LIMIT,
      });
      truncated = orders.length >= EXPORT_LIMIT;
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
        limit: EXPORT_LIMIT,
        production: String(req.query.production || 'all'),
        payment: String(req.query.payment || 'all'),
        sort: String(req.query.sort || 'date_desc'),
      });
      truncated = orders.length >= EXPORT_LIMIT;
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

    if (truncated) {
      // Une troncature silencieuse se lit comme un export complet. On la rend
      // visible dans le fichier lui-même, pas seulement dans les logs : c'est
      // le CSV qui part chez le comptable, pas la console.
      this.logger.warn(
        `Export ${type} (${period}) tronqué à ${EXPORT_LIMIT} lignes.`,
      );
      rows.push('');
      rows.push(
        q(
          `ATTENTION : export limité à ${EXPORT_LIMIT} lignes — des données ` +
            `plus anciennes de la période sont absentes. Exportez par ` +
            `tranches de dates plus courtes pour obtenir la totalité.`,
        ),
      );
    }

    res.type('text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + rows.join('\n')); // BOM : Excel lit correctement l'UTF-8
  }

  /**
   * POST /api/admin/settings — enregistre les réglages des relances.
   *
   * Les relances elles-mêmes partent de Shopify (renvoi de la facture du
   * brouillon) : ces réglages n'en pilotent que le déclenchement.
   */
  @Post('settings')
  async saveSettings(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.isAuthed(req))) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    // `reminderDays` n'est transmis QUE s'il figure dans le corps reçu.
    // Le transmettre systématiquement écrivait une liste vide en base dès
    // qu'un appel partiel ne le mentionnait pas — et depuis que « vide » est
    // distingué de « absent », cela revenait à désactiver les paliers à
    // l'insu de l'admin.
    const patch: Parameters<SettingsService['save']>[0] = {
      reminderEnabled: body.reminderEnabled === true || body.reminderEnabled === '1',
    };

    if (body.reminderDays !== undefined) {
      patch.reminderDays = String(body.reminderDays || '')
        .split(',')
        .map((d) => parseInt(d.trim(), 10))
        .filter((d) => Number.isFinite(d) && d > 0);
    }

    const saved = await this.settings.save(patch);
    res.json({ ok: true, settings: saved });
  }

  /**
   * GET /api/admin/status — état léger (compteurs) pour l'auto-rafraîchissement.
   * Le dashboard interroge cet endpoint périodiquement et ne se recharge que si
   * les compteurs ont changé (nouvelle commande/devis, etc.).
   */
  @Get('status')
  async status(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!(await this.isAuthed(req))) {
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
    if (!(await this.isAuthed(req))) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    await this.data.markOrdersSeen(Array.isArray(orderIds) ? orderIds : []);
    await this.data.markQuotesSeen(Array.isArray(quoteIds) ? quoteIds : []);
    res.json({ ok: true });
  }

  // ─────────────────────────────── Prix ───────────────────────────────
  // Prix unitaires affichés par le configurateur. Toute modification est aussi
  // poussée sur le variant Shopify : sans ça, le client paierait l'ancien prix
  // au checkout (le panier natif facture le prix du variant).

  /** GET /api/admin/pricing — prix actuels + libellés. */
  @Get('pricing')
  async getPricing(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!(await this.isAuthed(req))) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const { prices, tiers } = await this.pricing.getPayload();
    res.json({
      ok: true,
      prices,
      // Grilles dégressives par produit (voir PricingService.getTiers).
      tiers,
      labels: PRODUCT_LABELS,
      keys: PRODUCT_KEYS,
      // Les coins passent par un devis : pas de produit à synchroniser.
      variants: PRODUCT_SHOPIFY_IDS,
      // Produits dont le prix couvre toutes les couleurs/tailles.
      multiVariant: MULTI_VARIANT_KEYS,
      // Produits sur devis : le dashboard n'affiche PAS de champ de saisie
      // pour eux, puisque le serveur rejette leur prix (cf. QUOTE_ONLY_KEYS).
      quoteOnly: QUOTE_ONLY_KEYS,
    });
  }

  /**
   * POST /api/admin/pricing — enregistre les prix.
   * Body : { sweatshirt: 45, patches: 2.45, ... } (partiel accepté).
   * Chaque produit ayant un variant voit son prix Shopify mis à jour.
   */
  @Post('pricing')
  async savePricing(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.isAuthed(req))) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }

    // 1) Enregistrement local (source de vérité pour l'affichage).
    //    Les grilles dégressives arrivent sous `tiers` : { sweatshirt: [...] }.
    //    Le reste du corps porte les prix de base, clé par produit.
    const tiersInput = (body.tiers as Record<string, unknown>) || null;
    const prices = await this.pricing.save(body);
    if (tiersInput && typeof tiersInput === 'object') {
      await this.pricing.saveTiers(tiersInput);
    }

    // 2) Répercussion sur Shopify : TOUS les variants du produit (les textiles en
    //    ont un par couleur). Un échec n'annule pas l'enregistrement : on le
    //    remonte pour que l'admin puisse réagir.
    //
    //    On ne pousse QUE les prix réellement acceptés par `save()`. Tester la
    //    seule présence dans `body` poussait `prices[key]` — c'est-à-dire la
    //    valeur EN BASE — même quand la saisie avait été rejetée (non
    //    numérique, négative, produit sur devis). Une correction faite
    //    directement dans Shopify était alors écrasée par l'ancienne valeur,
    //    que l'admin n'avait jamais saisie.
    const warnings: string[] = [];
    const rejected: string[] = [];
    for (const key of PRODUCT_KEYS) {
      if (!(key in body)) continue; // non modifié
      const productId = PRODUCT_SHOPIFY_IDS[key];
      if (!productId) continue; // coins : devis, pas de produit à synchroniser

      // La valeur soumise a-t-elle survécu à `save()` ? Si elle diffère de ce
      // que la base contient, c'est qu'elle a été écartée : ne rien pousser.
      const submitted = Math.round(Number(body[key]) * 100) / 100;
      if (!Number.isFinite(submitted) || submitted !== prices[key]) {
        rejected.push(PRODUCT_LABELS[key]);
        continue;
      }

      try {
        const r = await this.shopify.updateProductPrice(productId, prices[key]);
        if (!r.ok) {
          warnings.push(`${PRODUCT_LABELS[key]} : ${r.error || 'échec Shopify'}`);
        }
      } catch (e) {
        warnings.push(`${PRODUCT_LABELS[key]} : ${(e as Error).message}`);
      }
    }
    if (rejected.length) {
      warnings.push(
        `Valeur refusée, prix inchangé : ${rejected.join(', ')}. ` +
          `Un prix doit être un nombre positif.`,
      );
    }

    // Les grilles sont renvoyées normalisées (triées, doublons fusionnés) :
    // le dashboard réaffiche exactement ce qui a été retenu.
    const tiers = await this.pricing.getTiers();
    res.json({ ok: true, prices, tiers, warnings });
  }

  /**
   * POST /api/admin/me/password — l'admin CONNECTÉ change son mot de passe.
   * Body : { currentPassword, newPassword }.
   * Accessible à tous les admins (chacun gère le sien), pas seulement l'owner.
   */
  @Post('me/password')
  async changeOwnPassword(
    @Req() req: Request,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
    @Res() res: Response,
  ): Promise<void> {
    const me = await this.currentAdmin(req);
    if (!me) {
      res.status(401).json({ ok: false, error: 'Non authentifié.' });
      return;
    }
    const result = await this.auth.changeOwnPassword(
      me.id,
      currentPassword,
      newPassword,
    );
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    // Le changement révoque toutes les sessions du compte (y compris celle-ci) :
    // on repose immédiatement un cookie frais pour que l'admin qui vient de
    // changer son mot de passe ne soit pas déconnecté de son propre dashboard.
    if (result.token) {
      res.cookie(this.auth.cookieName, result.token, {
        ...ADMIN_COOKIE,
        maxAge: 1000 * 60 * 60 * 12,
      });
    }
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
    const result = await this.auth.resetPassword(id, me.id);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, password: result.password, email: result.email });
  }
}

/**
 * Nonce CSP de la requête courante, posé par le middleware de `main.ts`.
 *
 * Les pages du dashboard portent leurs styles et leurs scripts en ligne : sans
 * ce jeton, la CSP les bloquerait. Renvoie une chaîne vide si le middleware
 * n'a pas tourné (tests unitaires appelant les vues directement), auquel cas
 * les balises sont émises sans attribut `nonce`.
 */
function nonceOf(req: Request): string {
  return (req as Request & { cspNonce?: string }).cspNonce || '';
}

/**
 * Hôtes dont les fichiers peuvent être téléchargés dans l'archive de production.
 *
 * Ces URLs proviennent des `properties` des lignes de commande — que le client
 * renseigne librement au moment d'ajouter au panier. Elles ne sont donc PAS de
 * confiance : sans liste blanche, `buildAndSendZip` interrogeait n'importe
 * quelle adresse, y compris sur le réseau interne du serveur.
 */
const ASSET_HOSTS = ['res.cloudinary.com', 'cdn.shopify.com'];

function isAllowedAssetUrl(raw: string): boolean {
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== 'https:') return false;
    const h = hostname.toLowerCase();
    return ASSET_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch {
    return false;
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
