import { SchemaCheckService } from '../src/health/schema-check.service';

/** Colonnes attendues par les entités, comparées à la base réelle. */
function base(colonnes: Array<[string, string]>) {
  return {
    options: { type: 'mysql' },
    entityMetadatas: [
      { tableName: 'orders', columns: [{ databaseName: 'shopifyOrderId' }, { databaseName: 'typoRetrouvee' }] },
      { tableName: 'message_templates', columns: [{ databaseName: 'id' }] },
    ],
    query: async () => colonnes.map(([t, c]) => ({ TABLE_NAME: t, COLUMN_NAME: c })),
  };
}

describe('SchemaCheckService', () => {
  it('liste exactement les tables et colonnes manquantes', async () => {
    const s = new SchemaCheckService(base([['orders', 'shopifyOrderId']]) as any);
    const erreurs: string[] = [];
    (s as any).logger = { log() {}, warn() {}, error: (m: string) => erreurs.push(m) };
    expect(await s.verifier()).toEqual(['orders.typoRetrouvee', 'message_templates']);
    expect(erreurs[0]).toContain('RattrapageSchema.sql');
  });

  it('ne signale rien quand le schéma est complet', async () => {
    const s = new SchemaCheckService(
      base([['orders', 'shopifyOrderId'], ['orders', 'typoRetrouvee'], ['message_templates', 'id']]) as any,
    );
    (s as any).logger = { log() {}, warn() {}, error() {} };
    expect(await s.verifier()).toEqual([]);
  });

  it('ne fait rien hors MySQL (tests sur SQLite)', async () => {
    const s = new SchemaCheckService({ options: { type: 'sqlite' } } as any);
    expect(await s.verifier()).toEqual([]);
  });
});
