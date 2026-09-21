import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTempAttachmentsToQuotes1703000000000 implements MigrationInterface {
    name = 'AddTempAttachmentsToQuotes1703000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            'quotes',
            new TableColumn({
                name: 'tempAttachments',
                type: 'json',
                isNullable: true,
                comment: 'Pièces jointes temporaires pour la facturation (URLs Cloudinary)'
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('quotes', 'tempAttachments');
    }
}