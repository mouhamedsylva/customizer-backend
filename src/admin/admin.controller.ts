import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { loginPage, dashboardPage } from './admin.view';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly data: AdminService,
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
    res
      .type('html')
      .send(dashboardPage(orders, quotes, designs, frontendUrl));
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
