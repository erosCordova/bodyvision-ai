# Hosted capture storage

PostgreSQL (Neon) is the only active image storage provider for the hosted sandbox.
The previously attempted Backblaze integration was disabled at the user's request.
On 26 November 2026 the database contained four capture objects and zero external
object references. No media migration or deletion is required.

Existing b2_file_id schema fields remain as historical migration compatibility;
the application never writes them or calls Backblaze. The historical SQL migration
is retained. Photographs remain encrypted, synthetic-only, access-scoped and subject
to existing retention and size limits. Production use still requires the security
and privacy acceptance gates.

