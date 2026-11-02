-- adr029: description_embedding (0028) caches each cleaned description's meaning vector
-- in a pgvector column. Neon ships the extension; it only needs enabling per database.
-- Rollback: DROP EXTENSION vector; only once nothing uses the type (drop 0028's table first).
CREATE EXTENSION IF NOT EXISTS vector;
