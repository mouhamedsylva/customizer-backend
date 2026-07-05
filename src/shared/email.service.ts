import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface OrderItemData {
  name: string;
  color?: string;
  size?: string;
  qty: number;
  price: number;
  img?: string;
}

export interface OrderConfirmationData {
  customerName: string;
  orderId: string | number;
  items: OrderItemData[];
  total: number;
}

export interface QuotePreview {
  label: string;
  base: string;
  logo?: string;
}

export interface QuoteEmailData {
  customerName: string;
  email: string;
  telephone?: string;
  entreprise?: string;
  message?: string;
  coinName: string;
  details: string[];
  qty: number;
  previews: QuotePreview[];
  quoteId: string;
}

/**
 * Service d'envoi d'emails via Nodemailer.
 * Adapte depuis l'ancien customizer-api/src/services/email.service.js.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('EMAIL_HOST'),
      port: parseInt(this.config.get<string>('EMAIL_PORT') || '587', 10),
      secure: this.config.get<string>('EMAIL_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('EMAIL_USER'),
        pass: this.config.get<string>('EMAIL_PASSWORD'),
      },
      // Timeouts pour éviter de bloquer indéfiniment si le SMTP ne répond pas
      // (utile sur les hébergeurs qui filtrent le port 587 sortant).
      connectionTimeout: 10000, // 10s pour établir la connexion
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  private get from(): string {
    return (
      this.config.get<string>('EMAIL_FROM') ||
      this.config.get<string>('EMAIL_USER') ||
      'noreply@localhost'
    );
  }

  /** Adresse de l'equipe qui recoit les demandes de devis. */
  private get teamAddress(): string {
    return (
      this.config.get<string>('EMAIL_TEAM') ||
      this.config.get<string>('EMAIL_USER') ||
      this.from
    );
  }

  /**
   * Envoie l'email de confirmation de commande au client.
   */
  async sendOrderConfirmation(
    to: string,
    orderData: OrderConfirmationData,
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Confirmation de votre commande personnalisee',
        html: this.generateOrderConfirmationHTML(orderData),
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      this.logger.error(`Echec envoi confirmation commande: ${(error as Error).message}`);
      throw new Error(`Echec envoi email: ${(error as Error).message}`);
    }
  }

  /**
   * Envoie la demande de devis a l'equipe interne.
   */
  async sendQuoteEmail(
    quoteData: QuoteEmailData,
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: this.teamAddress,
        replyTo: quoteData.email,
        subject: `Nouvelle demande de devis - ${quoteData.coinName} (${quoteData.qty} pieces)`,
        html: this.generateQuoteTeamHTML(quoteData),
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      this.logger.error(`Echec envoi devis equipe: ${(error as Error).message}`);
      throw new Error(`Echec envoi email: ${(error as Error).message}`);
    }
  }

  /**
   * Envoie l'accuse de reception de devis au client.
   */
  async sendQuoteAck(
    to: string,
    quoteData: QuoteEmailData,
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Nous avons bien recu votre demande de devis',
        html: this.generateQuoteAckHTML(quoteData),
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      this.logger.error(`Echec envoi accuse devis: ${(error as Error).message}`);
      throw new Error(`Echec envoi email: ${(error as Error).message}`);
    }
  }

  /** HTML de confirmation de commande. */
  private generateOrderConfirmationHTML(data: OrderConfirmationData): string {
    const rows = data.items
      .map(
        (it) => `
          <tr>
            <td style="padding:8px;border-bottom:1px solid #eee;">
              ${it.name}${it.color ? ` - ${it.color}` : ''}${it.size ? ` / ${it.size}` : ''}
            </td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${it.qty}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${it.price} EUR</td>
          </tr>`,
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #28a745; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 30px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .total { font-size: 20px; font-weight: bold; color: #2c5aa0; text-align: right; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div style="font-size:48px;">&#10003;</div>
            <h1>Commande Confirmee</h1>
          </div>
          <div class="content">
            <p>Bonjour ${data.customerName},</p>
            <p>Votre commande a bien ete enregistree !</p>
            <p><strong>Numero de commande :</strong> ${data.orderId}</p>
            <table>
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd;">Article</th>
                  <th style="text-align:center;padding:8px;border-bottom:2px solid #ddd;">Qte</th>
                  <th style="text-align:right;padding:8px;border-bottom:2px solid #ddd;">Prix</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="total">Total : ${data.total} EUR</div>
            <p style="margin-top:30px;">Nous allons traiter votre commande dans les plus brefs delais.</p>
            <p style="font-size:14px;color:#666;">Merci pour votre confiance !<br>L'equipe Custom Products</p>
          </div>
        </div>
      </body>
      </html>`;
  }

  /** HTML de la demande de devis envoyee a l'equipe. */
  private generateQuoteTeamHTML(data: QuoteEmailData): string {
    const details = data.details.map((d) => `<li>${d}</li>`).join('');
    const previews = data.previews
      .map(
        (p) => `
          <div style="margin:10px 0;">
            <strong>${p.label}</strong><br>
            <img src="${p.base}" alt="${p.label}" style="max-width:250px;border:1px solid #ddd;border-radius:6px;" />
            ${p.logo ? `<br><small>Logo: ${p.logo}</small>` : ''}
          </div>`,
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Arial,sans-serif;color:#333;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <h1 style="color:#2c5aa0;">Nouvelle demande de devis</h1>
          <p><strong>Reference devis :</strong> ${data.quoteId}</p>
          <h2>Client</h2>
          <ul>
            <li><strong>Nom :</strong> ${data.customerName}</li>
            <li><strong>Email :</strong> ${data.email}</li>
            ${data.telephone ? `<li><strong>Telephone :</strong> ${data.telephone}</li>` : ''}
            ${data.entreprise ? `<li><strong>Entreprise :</strong> ${data.entreprise}</li>` : ''}
          </ul>
          ${data.message ? `<p><strong>Message :</strong> ${data.message}</p>` : ''}
          <h2>Produit : ${data.coinName}</h2>
          <p><strong>Quantite :</strong> ${data.qty}</p>
          <ul>${details}</ul>
          <h2>Apercus</h2>
          ${previews}
        </div>
      </body>
      </html>`;
  }

  /** HTML de l'accuse de reception envoye au client. */
  private generateQuoteAckHTML(data: QuoteEmailData): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Arial,sans-serif;color:#333;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#1a1a1a;color:#fff;padding:20px;text-align:center;">
            <h1>Demande de devis recue</h1>
          </div>
          <div style="background:#f9f9f9;padding:30px;">
            <p>Bonjour ${data.customerName},</p>
            <p>Nous avons bien recu votre demande de devis pour <strong>${data.coinName}</strong> (${data.qty} pieces).</p>
            <p>Votre reference : <strong>${data.quoteId}</strong></p>
            <p>Notre equipe reviendra vers vous dans les plus brefs delais avec une proposition detaillee.</p>
            <p style="font-size:14px;color:#666;">Cordialement,<br>L'equipe Custom Products</p>
          </div>
        </div>
      </body>
      </html>`;
  }

  /** Verifie la configuration email. */
  async verifyConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.transporter.verify();
      return { success: true, message: 'Configuration email valide' };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }
}
