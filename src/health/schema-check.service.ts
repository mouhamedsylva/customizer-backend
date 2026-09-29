import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Fichier de rattrapage à lancer quand il manque quelque chose. */
export const FICHIER_RATTRAPAGE = 'src/database/migrations/1759100000000-RattrapageSchema.sql';

/**
 * Au démarrage, compare les colonnes que les entités attendent à celles de la
 * base, et dit EXACTEMENT ce qui manque.
 *
 * POURQUOI : `synchronize` est désactivé et les migrations s'appliquent à la
 * main (.sql). Un fichier oublié ne se voyait qu'au premier appel — « Unknown
 * column 'Order.typoRetrouvee' », dashboard hors service, commandes non
 * importées — pendant que /api/health restait vert. Désormais : erreur claire
 * dans les journaux dès le démarrage, et /api/health en 503 tant qu'il manque
 * une table ou une colonne.
 *
 * Ne bloque PAS le démarrage : le configurateur, les webhooks et le reste des
 * tables doivent continuer de fonctionner pendant la correction.
 */
@Injectable()
export class SchemaCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchemaCheckService.name);
  private manquants: string[] = [];
  private verifie = false;

  constructor(private readonly base: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.verifier();
  }

  /** Tables et colonnes manquantes (« table » ou « table.colonne »). */
  etat(): { verifie: boolean; manquants: string[] } {
    return { verifie: this.verifie, manquants: [...this.manquants] };
  }

  async verifier(): Promise<string[]> {
    /* information_schema n'existe que sous MySQL / MariaDB : la suite de tests
       tourne sur SQLite, où le schéma est créé par `synchronize`. */
    if (!['mysql', 'mariadb'].includes(String(this.base.options.type))) {
      this.verifie = true;
      return [];
    }
    try {
      const lignes: Array<{ TABLE_NAME: string; COLUMN_NAME: string }> = await this.base.query(
        'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()',
      );
      const present = new Map<string, Set<string>>();
      for (const l of lignes) {
        const t = String(l.TABLE_NAME).toLowerCase();
        if (!present.has(t)) present.set(t, new Set());
        present.get(t)!.add(String(l.COLUMN_NAME).toLowerCase());
      }

      const manquants: string[] = [];
      for (const meta of this.base.entityMetadatas) {
        const colonnes = present.get(meta.tableName.toLowerCase());
        if (!colonnes) {
          manquants.push(meta.tableName);
          continue;
        }
        for (const c of meta.columns) {
          if (!colonnes.has(c.databaseName.toLowerCase())) manquants.push(`${meta.tableName}.${c.databaseName}`);
        }
      }

      this.manquants = manquants;
      this.verifie = true;
      if (manquants.length) {
        this.logger.error(
          `SCHÉMA INCOMPLET — ${manquants.length} élément(s) manquant(s) : ${manquants.join(', ')}. ` +
            `Les requêtes sur ces tables échoueront (« Unknown column »). ` +
            `Lancez ${FICHIER_RATTRAPAGE} sur la base, sans redémarrer : il est rejouable.`,
        );
      } else {
        this.logger.log('Schéma de la base conforme aux entités.');
      }
      return manquants;
    } catch (e) {
      this.logger.warn(`Contrôle du schéma impossible : ${(e as Error).message}`);
      return [];
    }
  }
}
