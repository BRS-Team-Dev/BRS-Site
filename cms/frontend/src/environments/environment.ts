// Default = LOCAL (XAMPP at http://localhost/builtrightstudio/cms).
// Swapped via angular.json fileReplacements for dev / prod builds.
export const environment = {
  production: false,
  envName: 'local' as 'local' | 'dev' | 'prod',
  // No trailing slash. Used as a path prefix in api.ts and asset URL helpers.
  basePath: '/builtrightstudio/cms',
};
