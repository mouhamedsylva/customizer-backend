import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

/**
 * Réglages de l'atelier, tels qu'exposés au dashboard.
 *
 * Les relances partent de Shopify (renvoi de la facture du brouillon) : le
 * backend n'émet aucun e-mail en propre.
 */
export interface AdminSettings {
  /** Relances automatiques des devis impayés. */
  reminderEnabled: boolean;
  /** Jours après l'envoi de la facture (ex. [3, 7, 14]). */
  reminderDays: number[];
  /**
   * Mode maintenance du CONFIGURATEUR SEUL.
   *
   * À `true`, la page de personnalisation affiche un écran d'attente au lieu
   * de l'interface. Le récapitulatif, le panier et le reste de la boutique
   * Shopify restent accessibles : un client qui a déjà composé sa commande
   * doit pouvoir la terminer.
   *
   * Lu publiquement par le thème via GET /api/maintenance.
   */
  maintenanceEnabled: boolean;
}

const DEFAULTS: AdminSettings = {
  reminderEnabled: false,
  reminderDays: [3, 7, 14],
  /* Défaut OUVERT : une base neuve, ou une clé jamais écrite, sert le
     configurateur. Le défaut inverse fermerait la boutique au premier
     déploiement, avant même que l'admin ait vu le réglage. */
  maintenanceEnabled: false,
};

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly repo: Repository<Setting>,
  ) {}

  /** Lit tous les réglages (avec valeurs par défaut). */
  async get(): Promise<AdminSettings> {
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.key, r.value ?? '']));

    // `undefined` = jamais configuré -> valeurs par défaut.
    // `''` = paliers volontairement supprimés -> aucune relance.
    // Ces deux cas retombaient tous les deux sur [3, 7, 14] : vider le champ
    // était sans effet, et l'admin voyait sa saisie annulée sans explication.
    const rawDays = map.get('reminder_days');
    const days =
      rawDays === undefined
        ? DEFAULTS.reminderDays
        : rawDays
            .split(',')
            .map((d) => parseInt(d.trim(), 10))
            .filter((d) => Number.isFinite(d) && d > 0)
            .sort((a, b) => a - b);

    return {
      reminderEnabled: map.get('reminder_enabled') === '1',
      reminderDays: days,
      /* Même convention que ci-dessus : seul `'1'` vaut vrai. Une clé absente,
         vide ou abîmée laisse donc le configurateur OUVERT — le repli sûr. */
      maintenanceEnabled: map.get('maintenance_enabled') === '1',
    };
  }

  /** Enregistre les réglages soumis depuis le dashboard. */
  async save(input: Partial<AdminSettings>): Promise<AdminSettings> {
    const entries: Array<[string, string]> = [];

    if (input.reminderEnabled !== undefined) {
      entries.push(['reminder_enabled', input.reminderEnabled ? '1' : '0']);
    }
    if (input.reminderDays !== undefined) {
      const clean = (input.reminderDays || [])
        .map((d) => parseInt(String(d), 10))
        .filter((d) => Number.isFinite(d) && d > 0 && d <= 365)
        .sort((a, b) => a - b)
        .slice(0, 6);
      entries.push(['reminder_days', clean.join(',')]);
    }
    if (input.maintenanceEnabled !== undefined) {
      entries.push(['maintenance_enabled', input.maintenanceEnabled ? '1' : '0']);
    }
    for (const [key, value] of entries) {
      await this.repo.save(this.repo.create({ key, value }));
    }
    return this.get();
  }
}
