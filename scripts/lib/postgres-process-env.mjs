/** Use only the checked connection URL, not inherited libpq routing overrides. */
export function sanitizedPostgresEnvironment(environment) {
  const childEnvironment = { ...environment };
  for (const key of Object.keys(childEnvironment)) {
    if (/^(PGHOSTADDR|PGSERVICE|PGSERVICEFILE|PGSYSCONFDIR)$/i.test(key)) delete childEnvironment[key];
  }
  return childEnvironment;
}
