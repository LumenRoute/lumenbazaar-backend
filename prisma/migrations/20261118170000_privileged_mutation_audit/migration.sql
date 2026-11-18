CREATE TABLE "PrivilegedMutationAudit" (
  "sequence" BIGSERIAL PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "id" TEXT NOT NULL UNIQUE,
  "actorId" TEXT NOT NULL, "actorType" TEXT NOT NULL, "action" TEXT NOT NULL,
  "targetId" TEXT NOT NULL, "targetType" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL, "outcome" TEXT NOT NULL,
  "previousHash" TEXT NOT NULL, "recordHash" TEXT NOT NULL UNIQUE
);
CREATE FUNCTION reject_privileged_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Privileged mutation audit records are append-only'; END;
$$;
CREATE TRIGGER privileged_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
ON "PrivilegedMutationAudit" FOR EACH STATEMENT EXECUTE FUNCTION reject_privileged_audit_change();
