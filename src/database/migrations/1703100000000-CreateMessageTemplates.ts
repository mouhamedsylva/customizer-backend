import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateMessageTemplates1703100000000 implements MigrationInterface {
  name = 'CreateMessageTemplates1703100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'message_templates',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '36',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid()',
          },
          {
            name: 'type',
            type: 'varchar',
            length: '50',
            isUnique: false,
            comment: 'Type de message : invoice, reminder, etc.',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
            comment: 'Nom descriptif du modèle',
          },
          {
            name: 'content',
            type: 'text',
            comment: 'Contenu du message avec variables {nom}, {produit}, etc.',
          },
          {
            name: 'isActive',
            type: 'tinyint',
            default: 1,
            comment: 'Modèle actif ou désactivé',
          },
          {
            name: 'isDefault',
            type: 'tinyint',
            default: 0,
            comment: 'Modèle par défaut pour ce type de message',
          },
          {
            name: 'createdAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_MESSAGE_TEMPLATES_TYPE_DEFAULT',
            columnNames: ['type', 'isDefault'],
          },
          {
            name: 'IDX_MESSAGE_TEMPLATES_TYPE_ACTIVE',
            columnNames: ['type', 'isActive'],
          },
        ],
      }),
      true
    );

    // Insertion des modèles par défaut
    await queryRunner.query(`
      INSERT INTO message_templates (id, type, name, content, isActive, isDefault) VALUES 
      (UUID(), 'invoice', 'Facture standard', 'Bonjour {nom},\n\nVoici votre devis pour {produit}. Vous pouvez le régler directement via le lien ci-dessous.\n\nMerci de votre confiance.\nL''équipe Custom Textile', 1, 1),
      (UUID(), 'reminder', 'Relance standard', 'Bonjour {nom},\n\nNous revenons vers vous au sujet de votre devis pour {produit}, qui reste en attente de règlement.\n\nVous pouvez le régler directement via le lien ci-dessous. N''hésitez pas à nous écrire si vous avez la moindre question.\n\nBien cordialement,\nL''équipe Custom Textile', 1, 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('message_templates');
  }
}