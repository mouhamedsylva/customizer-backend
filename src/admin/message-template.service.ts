import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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

/**
 * Les textes de départ, en UN SEUL exemplaire.
 *
 * Ils étaient dupliqués quatre fois — ici, dans le seed, dans la migration et
 * dans le JavaScript du dashboard. Toute reformulation en oubliait un, et les
 * versions divergeaient sans que rien ne le signale.
 *
 * Le vocabulaire est uniformisé sur « devis » : c'est bien un devis que le
 * client reçoit avant paiement, quel que soit l'intitulé de l'onglet.
 */
const TEXTES_PAR_DEFAUT = {
  invoice: {
    type: 'invoice',
    name: 'Message de devis',
    content: `Bonjour {nom},

Voici votre devis pour {produit}. Vous pouvez le régler directement via le lien ci-dessous.

Merci de votre confiance.
L'équipe Massacre Officiel`,
  },
  reminder: {
    type: 'reminder',
    name: 'Message de relance',
    content: `Bonjour {nom},

Nous revenons vers vous au sujet de votre devis pour {produit}, qui reste en attente de règlement.

Vous pouvez le régler directement via le lien ci-dessous. N'hésitez pas à nous écrire si vous avez la moindre question.

Bien cordialement,
L'équipe Massacre Officiel`,
  },
} as const;

@Injectable()
export class MessageTemplateService implements OnModuleInit {
  private readonly logger = new Logger(MessageTemplateService.name);

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templates: Repository<MessageTemplate>,
  ) {}

  async onModuleInit(): Promise<void> {
    /* Initialise les templates par défaut au démarrage — SANS pouvoir faire
       échouer ce démarrage : si la table `message_templates` manque, l'erreur
       remontait jusqu'à Nest, l'application ne démarrait plus et Docker la
       relançait en boucle (configurateur, webhooks et dashboard hors
       service). Les factures partent alors avec le message de repli, et
       SchemaCheckService signale la table manquante. */
    try {
      await this.initializeDefaultTemplates();
    } catch (e) {
      this.logger.error(
        `Modèles de message indisponibles (${(e as Error).message}) : ` +
          'messages de repli utilisés. Voir le contrôle du schéma au démarrage.',
      );
    }
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
    /* Trois défauts corrigés, le tout en UNE transaction :
       - une mise à jour sans `isDefault` le remettait à false (`?? false`) : le
         modèle cessait d'être le défaut et les factures repartaient sur le
         texte de repli. Absent = inchangé ;
       - la remise à zéro des autres défauts utilisait le type ENVOYÉ, et non
         celui du modèle réel ; elle avait aussi lieu avant de vérifier que le
         modèle existe — un id inconnu laissait le type sans aucun défaut ;
       - sans transaction, un échec entre les deux écritures laissait le même
         état sans défaut. */
    return this.templates.manager.transaction(async (m) => {
      const repo = m.getRepository(MessageTemplate);

      if (data.id) {
        const existant = await repo.findOne({ where: { id: data.id } });
        if (!existant) throw new NotFoundException('Modèle de message introuvable');
        const devientDefaut = data.isDefault ?? existant.isDefault;
        if (devientDefaut && !existant.isDefault) {
          await repo.update({ type: existant.type }, { isDefault: false });
        }
        await repo.update(existant.id, {
          name: data.name,
          content: data.content,
          isActive: data.isActive ?? existant.isActive,
          isDefault: devientDefaut,
        });
        return (await repo.findOne({ where: { id: existant.id } })) as MessageTemplate;
      }

      if (data.isDefault) {
        await repo.update({ type: data.type }, { isDefault: false });
      }
      return repo.save(
        repo.create({
          type: data.type,
          name: data.name,
          content: data.content,
          isActive: data.isActive ?? true,
          isDefault: data.isDefault ?? false,
        }),
      );
    });
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

    /* Remplacement par FONCTION : avec une chaîne, `$&`, `$'` ou `` $` ``
       présents dans une valeur saisie par le client (nom, entreprise) étaient
       interprétés et réinjectaient des morceaux du modèle dans l'e-mail. */
    const mettre = (re: RegExp, v: string) => {
      result = result.replace(re, () => v);
    };
    mettre(/\{nom\}/g, variables.nom || '');
    mettre(/\{produit\}/g, variables.produit || 'votre commande personnalisée');
    mettre(/\{quantite\}/g, String(variables.quantite || 1));
    mettre(/\{total\}/g, variables.total || '');
    mettre(/\{entreprise\}/g, variables.entreprise || '');

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
   * Message de repli, quand aucun modèle n'est configuré en base.
   *
   * Il réutilise TEXTES_PAR_DEFAUT : le même texte existait auparavant en
   * quatre exemplaires (ici, dans le seed ci-dessous, dans la migration et
   * dans le dashboard). Corriger une formulation en oubliait toujours un.
   */
  private getDefaultInvoiceMessage(variables: {
    nom?: string;
    produit?: string;
    quantite?: number | string;
    total?: string;
    entreprise?: string;
  }): string {
    return this.replaceVariables(TEXTES_PAR_DEFAUT.invoice.content, variables);
  }

  /**
   * Crée les modèles de départ si la table est vide.
   *
   * Fait double emploi avec la migration, qui insère les mêmes textes. On le
   * garde comme filet : une base créée sans migration (développement local
   * avec DB_SYNCHRONIZE) partirait sinon sans aucun message.
   */
  async initializeDefaultTemplates(): Promise<void> {
    const count = await this.templates.count();
    if (count > 0) return; // Déjà initialisé

    await this.saveTemplate({ ...TEXTES_PAR_DEFAUT.invoice, isActive: true, isDefault: true });
    await this.saveTemplate({ ...TEXTES_PAR_DEFAUT.reminder, isActive: true, isDefault: true });
  }
}