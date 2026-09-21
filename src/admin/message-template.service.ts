import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageTemplate } from '../database/entities/message-template.entity';

/**
 * Service pour la gestion des modèles de messages personnalisables.
 * 
 * Gère les templates de messages avec variables de substitution :
 * - {nom} : nom du client
 * - {produit} : nom du produit/coin
 * - {quantite} : quantité commandée
 * - {total} : montant total
 * - {entreprise} : nom de l'entreprise du client
 */
@Injectable()
export class MessageTemplateService implements OnModuleInit {
  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templates: Repository<MessageTemplate>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialise les templates par défaut au démarrage
    await this.initializeDefaultTemplates();
  }

  /**
   * Récupère le modèle par défaut pour un type de message donné.
   */
  async getDefaultTemplate(type: string): Promise<MessageTemplate | null> {
    return this.templates.findOne({
      where: { type, isDefault: true, isActive: true }
    });
  }

  /**
   * Récupère tous les modèles d'un type donné.
   */
  async getTemplatesByType(type: string): Promise<MessageTemplate[]> {
    return this.templates.find({
      where: { type },
      order: { isDefault: 'DESC', name: 'ASC' }
    });
  }

  /**
   * Récupère tous les modèles pour l'interface d'administration.
   */
  async getAllTemplates(): Promise<MessageTemplate[]> {
    return this.templates.find({
      order: { type: 'ASC', isDefault: 'DESC', name: 'ASC' }
    });
  }

  /**
   * Crée ou met à jour un modèle de message.
   */
  async saveTemplate(data: {
    id?: string;
    type: string;
    name: string;
    content: string;
    isActive?: boolean;
    isDefault?: boolean;
  }): Promise<MessageTemplate> {
    // Si c'est marqué comme défaut, désactiver les autres défauts du même type
    if (data.isDefault) {
      await this.templates.update(
        { type: data.type },
        { isDefault: false }
      );
    }

    if (data.id) {
      // Mise à jour
      await this.templates.update(data.id, {
        name: data.name,
        content: data.content,
        isActive: data.isActive ?? true,
        isDefault: data.isDefault ?? false
      });
      
      const updated = await this.templates.findOne({ where: { id: data.id } });
      if (!updated) {
        throw new NotFoundException('Modèle de message introuvable');
      }
      return updated;
    } else {
      // Création
      const template = this.templates.create({
        type: data.type,
        name: data.name,
        content: data.content,
        isActive: data.isActive ?? true,
        isDefault: data.isDefault ?? false
      });
      return this.templates.save(template);
    }
  }

  /**
   * Supprime un modèle de message.
   */
  async deleteTemplate(id: string): Promise<void> {
    const template = await this.templates.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException('Modèle de message introuvable');
    }

    await this.templates.delete(id);
  }

  /**
   * Remplace les variables dans un message par leurs valeurs réelles.
   * 
   * Variables supportées :
   * - {nom} : nom du client
   * - {produit} : nom du produit
   * - {quantite} : quantité
   * - {total} : montant total
   * - {entreprise} : entreprise du client
   */
  replaceVariables(template: string, variables: {
    nom?: string;
    produit?: string;
    quantite?: number | string;
    total?: string;
    entreprise?: string;
  }): string {
    let result = template;

    // Remplacements sécurisés avec fallback
    result = result.replace(/\{nom\}/g, variables.nom || '');
    result = result.replace(/\{produit\}/g, variables.produit || 'votre commande personnalisée');
    result = result.replace(/\{quantite\}/g, String(variables.quantite || 1));
    result = result.replace(/\{total\}/g, variables.total || '');
    result = result.replace(/\{entreprise\}/g, variables.entreprise || '');

    return result;
  }

  /**
   * Génère un message personnalisé pour une facture.
   */
  async generateInvoiceMessage(variables: {
    nom?: string;
    produit?: string;
    quantite?: number | string;
    total?: string;
    entreprise?: string;
  }): Promise<string> {
    // Récupère le modèle par défaut pour les factures
    const template = await this.getDefaultTemplate('invoice');
    
    if (!template) {
      // Message par défaut si aucun modèle configuré
      return this.getDefaultInvoiceMessage(variables);
    }

    return this.replaceVariables(template.content, variables);
  }

  /**
   * Message par défaut de fallback (l'ancien message codé en dur).
   */
  private getDefaultInvoiceMessage(variables: {
    nom?: string;
    produit?: string;
    quantite?: number | string;
    total?: string;
    entreprise?: string;
  }): string {
    return `Bonjour ${variables.nom || ''},

Voici votre devis pour ${variables.produit || 'votre commande personnalisée'}. Vous pouvez le régler directement via le lien ci-dessous.

Merci de votre confiance.
L'équipe Custom Textile`;
  }

  /**
   * Initialise les modèles par défaut si la table est vide.
   */
  async initializeDefaultTemplates(): Promise<void> {
    const count = await this.templates.count();
    if (count > 0) return; // Déjà initialisé

    // Modèle par défaut pour les factures
    await this.saveTemplate({
      type: 'invoice',
      name: 'Facture standard',
      content: `Bonjour {nom},

Voici votre devis pour {produit}. Vous pouvez le régler directement via le lien ci-dessous.

Merci de votre confiance.
L'équipe Custom Textile`,
      isActive: true,
      isDefault: true
    });

    // Modèle par défaut pour les relances
    await this.saveTemplate({
      type: 'reminder',
      name: 'Relance standard',
      content: `Bonjour {nom},

Nous revenons vers vous au sujet de votre devis pour {produit}, qui reste en attente de règlement.

Vous pouvez le régler directement via le lien ci-dessous. N'hésitez pas à nous écrire si vous avez la moindre question.

Bien cordialement,
L'équipe Custom Textile`,
      isActive: true,
      isDefault: true
    });
  }
}