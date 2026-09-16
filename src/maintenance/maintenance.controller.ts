import { Controller, Get } from '@nestjs/common';
import { SettingsService } from '../admin/settings.service';

/**
 * Mode maintenance du configurateur, en LECTURE SEULE et PUBLIC.
 *
 * Le thème Shopify interroge cet endpoint au chargement de la page de
 * personnalisation, puis toutes les minutes : un onglet déjà ouvert bascule
 * donc de lui-même quand l'admin coupe le configurateur, sans rechargement.
 *
 * L'écriture se fait uniquement depuis le dashboard (POST /api/admin/settings,
 * authentifié). Même découpage que les prix : une seule source de vérité, deux
 * portes — l'une ouverte en lecture, l'autre gardée en écriture.
 */
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly settings: SettingsService) {}

  /* CACHE MÉMOIRE COURT.
   *
   * Chaque visiteur du configurateur appelle cet endpoint au chargement PUIS
   * toutes les minutes. Interroger MySQL à chaque fois pour un booléen qui
   * change trois fois par an serait absurde — et sur un pic de trafic, ces
   * requêtes-là s'ajouteraient à celles qui comptent vraiment.
   *
   * 15 secondes : l'admin qui coupe le configurateur voit l'effet presque tout
   * de suite, et la charge reste plate quel que soit le nombre de visiteurs.
   * Le délai s'ajoute à celui du sondage côté thème (60 s), ce qui reste bien
   * en deçà de ce qu'un client remarque.
   *
   * Un seul processus sert l'API (conteneur unique) : une variable de module
   * suffit, il n'y a pas de cache à partager entre instances. */
  private cache: { valeur: boolean; expire: number } | null = null;
  private static readonly TTL_MS = 15_000;

  /**
   * GET /api/maintenance — le configurateur est-il fermé ?
   *
   * Réponse volontairement minimale : le thème n'a besoin que du booléen, et
   * cet endpoint est public. Y exposer d'autres réglages reviendrait à publier
   * la configuration de l'atelier à qui la demande.
   */
  @Get()
  async get(): Promise<{ ok: boolean; maintenance: boolean }> {
    const maintenant = Date.now();
    if (this.cache && this.cache.expire > maintenant) {
      return { ok: true, maintenance: this.cache.valeur };
    }

    const { maintenanceEnabled } = await this.settings.get();
    this.cache = {
      valeur: maintenanceEnabled,
      expire: maintenant + MaintenanceController.TTL_MS,
    };
    return { ok: true, maintenance: maintenanceEnabled };
  }
}
