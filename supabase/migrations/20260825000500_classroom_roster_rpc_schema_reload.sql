-- PostgREST caches RPC signatures independently from PostgreSQL. Keep this
-- reload in the migration batch so direct/self-hosted migration runs expose
-- the new roster functions without requiring a service restart.
notify pgrst, 'reload schema';
