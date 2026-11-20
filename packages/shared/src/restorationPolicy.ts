/**
 * Resource soft-delete and purge policy constants.
 * Defines the bounded restoration window and deterministic purge rules.
 *
 * When a resource is soft-deleted, the owner has a bounded window to restore it
 * before it is permanently purged from the database. After the restoration window
 * expires, the purge worker deterministically purges records in batches.
 *
 * Settlement and receipt records are never cascaded; instead, catalog data is
 * redacted or tombstoned to preserve required payment settlement evidence.
 */

/**
 * Restoration window: duration in milliseconds for which a deleted resource
 * can be restored by its owner.
 *
 * Default: 30 days = 30 * 24 * 60 * 60 * 1000 ms
 *
 * This is a single named constant used throughout the codebase; it must never
 * be hardcoded elsewhere.
 */
export const RESOURCE_RESTORATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Calculate the restoration deadline for a newly deleted resource.
 * @param deletedAt - The timestamp when the resource was deleted
 * @returns The deadline after which the resource can no longer be restored
 */
export function calculateRestorationDeadline(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + RESOURCE_RESTORATION_WINDOW_MS);
}

/**
 * Check if a resource is within its restoration window.
 * @param restoreDeadline - The restoration deadline for the resource
 * @returns true if the restoration deadline has not yet passed
 */
export function isWithinRestorationWindow(restoreDeadline: Date | null): boolean {
  if (restoreDeadline === null) {
    return false;
  }
  return new Date() < restoreDeadline;
}

/**
 * Purge batch configuration for deterministic, resumable purging.
 *
 * Batches are ordered by restoreDeadline ascending (oldest first), then by id
 * for stability. This ensures deterministic ordering across runs and allows
 * resumption from a cursor.
 */
export const PURGE_BATCH_SIZE = 100;

/**
 * Error codes for restoration validation.
 */
export enum RestoreErrorCode {
  /** Resource was not found or is not soft-deleted */
  NOT_DELETED = "RESOURCE_NOT_DELETED",
  /** Caller is not the resource owner */
  NOT_OWNER = "RESTORE_NOT_OWNER",
  /** Restoration window has expired */
  WINDOW_EXPIRED = "RESTORE_WINDOW_EXPIRED",
  /** Resource has already been purged */
  ALREADY_PURGED = "RESOURCE_ALREADY_PURGED"
}
