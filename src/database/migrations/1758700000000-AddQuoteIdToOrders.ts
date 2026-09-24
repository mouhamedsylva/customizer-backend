import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Rattache une commande à son devis d'origine.
 *
 * L'UUID du devis voyage déjà dans la propriété « Référence devis » de chaque
 * ligne (quotes.service.ts), mais `saveOrder` ne testait que le NOM de cette
 * propriété et jetait sa valeur : le lien devis↔commande n'existait nulle part
 * en base, et était reconstruit en mémoire à chaque affichage du dashboard.
 *
 * Colonne indexée et NULLABLE : tout l'historique reste à null, ce qui est
 * correct — le rapprochement en mémoire continue de le couvrir.
 */
export class AddQuoteIdToOrders1758700000000 implements MigrationInterface {
  name = 'AddQuoteIdToOrders1758700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'orders',
      new TableColumn({
        name: 'quoteId',
        type: 'char',
        length: '36',
        isNullable: true,
        comment: "Devis d'origine (UUID), null pour une vente directe",
      }),
    );

    await queryRunner.createIndex(
      'orders',
      new TableIndex({
        name: 'IDX_orders_quoteId',
        columnNames: ['quoteId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('orders', 'IDX_orders_quoteId');
    await queryRunner.dropColumn('orders', 'quoteId');
  }
}
