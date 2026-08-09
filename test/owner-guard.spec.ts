import { AdminAuthService } from '../src/admin/admin-auth.service';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { Admin } from '../src/database/entities/admin.entity';
import type { Setting } from '../src/database/entities/setting.entity';

/**
 * Protection du compte principal (owner).
 *
 * `setBlocked` refusait déjà de bloquer l'owner au niveau du SERVICE, mais
 * `resetPassword` s'en remettait au seul contrôleur. La route est réservée à
 * l'owner aujourd'hui — mais rien dans la méthode ne l'imposait : la passer
 * derrière `AdminSessionGuard` (qui vérifie l'authentification, PAS le rôle)
 * ou l'appeler depuis un script aurait suffi à permettre à n'importe quel
 * admin de réinitialiser le mot de passe du propriétaire et de le lire dans la
 * réponse.
 *
 * Le dashboard masquant déjà le bouton pour l'owner, l'absence de garde
 * serveur ne se voyait pas à l'usage.
 */
function build(admins: Partial<Admin>[]) {
  const store = admins.map((a) => ({ ...a }) as Admin);
  const repo = {
    findOne: async (o: { where: { id?: string; email?: string } }) =>
      store.find(
        (a) =>
          (o.where.id !== undefined && a.id === o.where.id) ||
          (o.where.email !== undefined && a.email === o.where.email),
      ) || null,
    find: async () => store,
    save: async (a: Admin) => a,
    count: async () => store.length,
    create: (a: Partial<Admin>) => a as Admin,
  } as unknown as Repository<Admin>;

  const config = {
    get: (k: string) =>
      k === 'ADMIN_SESSION_SECRET' ? 'x'.repeat(48) : undefined,
  } as unknown as ConfigService;

  const settings = {
    findOne: async () => null,
    save: async (x: unknown) => x,
    create: (x: unknown) => x,
  } as unknown as Repository<Setting>;

  return new AdminAuthService(config, repo, settings);
}

const OWNER: Partial<Admin> = {
  id: 'owner-1',
  email: 'patron@exemple.fr',
  role: 'owner',
  passwordHash: 'x',
  blocked: false,
};

const ADMIN: Partial<Admin> = {
  id: 'admin-1',
  email: 'equipe@exemple.fr',
  role: 'admin',
  passwordHash: 'y',
  blocked: false,
};

describe('resetPassword — garde propriétaire', () => {
  it('REFUSE de réinitialiser le mot de passe de l’owner', async () => {
    const s = build([OWNER, ADMIN]);
    const r = await s.resetPassword('owner-1', 'admin-1');
    expect(r.ok).toBe(false);
    // Aucun mot de passe ne doit fuiter dans la réponse.
    expect(r.password).toBeUndefined();
  });

  it('refuse même quand l’appelant n’est pas précisé', async () => {
    // Cas d'un script ou d'un futur appelant interne : la garde ne doit pas
    // dépendre de la présence d'un `actorId`.
    const s = build([OWNER]);
    const r = await s.resetPassword('owner-1');
    expect(r.ok).toBe(false);
    expect(r.password).toBeUndefined();
  });

  it('autorise la réinitialisation d’un admin ordinaire', async () => {
    const s = build([OWNER, ADMIN]);
    const r = await s.resetPassword('admin-1', 'owner-1');
    expect(r.ok).toBe(true);
    expect(typeof r.password).toBe('string');
    expect((r.password as string).length).toBeGreaterThanOrEqual(8);
    expect(r.email).toBe('equipe@exemple.fr');
  });

  it('refuse toujours l’auto-réinitialisation', async () => {
    // Le mot de passe n'est affiché qu'une fois : un owner qui perdrait la
    // réponse se retrouverait dehors sans récupération possible.
    const s = build([ADMIN]);
    const r = await s.resetPassword('admin-1', 'admin-1');
    expect(r.ok).toBe(false);
  });

  it('refuse un compte inexistant', async () => {
    const s = build([OWNER]);
    const r = await s.resetPassword('fantome', 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('introuvable');
  });
});

describe('setBlocked — garde propriétaire (comportement de référence)', () => {
  it('refuse de bloquer l’owner', async () => {
    const s = build([OWNER, ADMIN]);
    const r = await s.setBlocked('owner-1', true, 'admin-1');
    expect(r.ok).toBe(false);
  });

  it('autorise le blocage d’un admin ordinaire', async () => {
    const s = build([OWNER, ADMIN]);
    const r = await s.setBlocked('admin-1', true, 'owner-1');
    expect(r.ok).toBe(true);
  });

  it('refuse l’auto-blocage', async () => {
    const s = build([ADMIN]);
    const r = await s.setBlocked('admin-1', true, 'admin-1');
    expect(r.ok).toBe(false);
  });
});
