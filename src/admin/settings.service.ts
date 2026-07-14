import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

/** Réglages de l'atelier, tels qu'exposés au dashboard. */
export interface AdminSettings {
  /** Relances automatiques des devis impayés. */
  reminderEnabled: boolean;
  /** Jours après l'envoi de la facture (ex. [3, 7, 14]). */
  reminderDays: number[];
  /** Envoi d'un e-mail à l'équipe sur nouvelle commande / devis. */
  notifyEmailEnabled: boolean;
  /** Adresse de l'équipe. */
  notifyEmail: string;
}

const DEFAULTS: AdminSettings = {
  reminderEnabled: false,
  reminderDays: [3, 7, 14],
  notifyEmailEnabled: false,
  notifyEmail: '',
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

    const days = (map.get('reminder_days') || '')
      .split(',')
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => Number.isFinite(d) && d > 0)
      .sort((a, b) => a - b);

    return {
      reminderEnabled: map.get('reminder_enabled') === '1',
      reminderDays: days.length ? days : DEFAULTS.reminderDays,
      notifyEmailEnabled: map.get('notify_email_enabled') === '1',
      notifyEmail: map.get('notify_email') || '',
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
    if (input.notifyEmailEnabled !== undefined) {
      entries.push([
        'notify_email_enabled',
        input.notifyEmailEnabled ? '1' : '0',
      ]);
    }
    if (input.notifyEmail !== undefined) {
      entries.push(['notify_email', (input.notifyEmail || '').trim()]);
    }

    for (const [key, value] of entries) {
      await this.repo.save(this.repo.create({ key, value }));
    }
    return this.get();
  }
}
