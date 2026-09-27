import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Typo du texte retrouvée depuis le SVG de découpe (anciennes commandes).
 *
 * Voir Order.typoRetrouvee. Colonne NULLABLE : null = rien retrouvé, ou
 * commande récente qui porte déjà ses propriétés `_Texte*`.
 *
 * ⚠ Comme les autres migrations du dossier, ce fichier n'est pas exécuté : le
 * chemin réel est le .sql jumeau, à appliquer AVANT de déployer.
 */
export class AddTypoRetrouveeToOrders1759000000000 implements MigrationInterface {
  name = 'AddTypoRetrouveeToOrders1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'orders',
      new TableColumn({
        name: 'typoRetrouvee',
        type: 'json',
        isNullable: true,
        comment: 'Typo du texte retrouvée depuis le SVG (anciennes commandes)',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('orders', 'typoRetrouvee');
  }
}
