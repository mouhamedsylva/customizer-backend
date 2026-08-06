/**
 * Tests unitaires et d'intégration légers.
 *
 * Le périmètre vise la logique qui s'est déjà régressée en silence : politique
 * de sécurité (CSP), validation d'URL d'image, machine à états d'expédition,
 * jetons de session et de panier, grilles tarifaires. Ce sont des fonctions
 * pures ou quasi-pures — aucune base de données n'est nécessaire.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // `isolatedModules` est posé dans tsconfig.json : le dashboard fait 4 400
  // lignes, le typer entièrement à chaque test coûterait plus que les tests.
  transform: { '^.+\\.ts$': ['ts-jest', {}] },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  testTimeout: 15000,
};
