import { dashboardPage } from '../src/admin/admin.view';
it('grilles : PVC, tissé et coin sans prix catalogue, brodé et textiles avec', () => {
  const pricing = { prices: { sweatshirt: 60, tshirt: 29.5, tshirt_polyester: 29.5, coins: 0, drapeaux: 19.9, patches: 20, manche: 4 }, tiers: {} } as any;
  const html = dashboardPage([], [], [], 'https://x', '', { pricing });
  const m = html.match(/data-grilles="([^"]*)"/);
  const g = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"));
  expect(g['Patch personnalisé (PVC)']).toBeNull();
  expect(g['Patch personnalisé (tissé)']).toBeNull();
  expect(g['Coin métal personnalisé']).toBeNull();
  expect(g['Patch personnalisé (brodé)']).toMatchObject({ base: 20, enHt: true });
  expect(g['Sweatshirt personnalisé']).toMatchObject({ base: 60 });
});
