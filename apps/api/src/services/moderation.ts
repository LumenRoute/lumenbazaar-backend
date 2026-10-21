import { randomUUID } from "node:crypto";

import { type Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  LumenError,
  type JsonObject,
  type ModerationActionType,
  type ModerationEvidenceReference,
  type ModerationNotification,
  type ModerationNotificationStatus,
  type ModerationReasonCode,
  type ModerationResolutionCode,
  type ModerationState,
  type Resource,
  type ResourceDiscoveryState,
  type ResourceModerationAction,
  type ResourceModerationView,
  type ResourceVersion
} from "@lumenbazaar/shared";

import { type AuditLogService } from "./audit.js";
import { type ResourceService, type ResourceStore } from "./resources.js";

const moderationReasonCodes = [
  "abuse",
  "deceptive",
  "compromised",
  "unsafe",
  "unsuitable",
  "copyright",
  "policy_violation",
  "other"
] as const satisfies readonly ModerationReasonCode[];

const moderationResolutionCodes = [
  "appeal_upheld",
  "false_positive",
  "manual_restore"
] as const satisfies readonly ModerationResolutionCode[];

const moderationEvidenceTypes = ["url", "report", "transaction", "screenshot", "other"] as const;

const reviewerIdSchema = z.string().trim().min(1).max(128);

export const moderationEvidenceReferenceSchema = z
  .object({
    type: z.enum(moderationEvidenceTypes).default("other"),
    ref: z.string().trim().min(1).max(2048),
    description: z.string().trim().min(1).max(500).optional()
  })
  .strict();

const evidenceRefsSchema = z.array(moderationEvidenceReferenceSchema).max(20);

export const quarantineResourceVersionSchema = z
  .object({
    reasonCode: z.enum(moderationReasonCodes),
    evidenceRefs: evidenceRefsSchema.min(1),
    notes: z.string().trim().max(2000).optional(),
    reviewerId: reviewerIdSchema,
    notifySeller: z.boolean().default(true)
  })
  .strict();

export const restoreResourceVersionSchema = z
  .object({
    reasonCode: z.enum(moderationResolutionCodes).default("manual_restore"),
    evidenceRefs: evidenceRefsSchema.default([]),
    notes: z.string().trim().max(2000).optional(),
    reviewerId: reviewerIdSchema,
    notifySeller: z.boolean().default(true)
  })
  .strict();

export const appealResourceVersionSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    evidenceRefs: evidenceRefsSchema.default([])
  })
  .strict();

export const rejectAppealSchema = z
  .object({
    reasonCode: z.enum(moderationReasonCodes).default("other"),
    evidenceRefs: evidenceRefsSchema.default([]),
    notes: z.string().trim().max(2000).optional(),
    reviewerId: reviewerIdSchema,
    notifySeller: z.boolean().default(true)
  })
  .strict();

export const moderationNotificationStatusSchema = z
  .object({
    status: z.enum(["notified", "failed"]),
    reviewerId: reviewerIdSchema,
    failureReason: z.string().trim().max(500).optional()
  })
  .strict();

export type QuarantineResourceVersionInput = z.output<typeof quarantineResourceVersionSchema>;
export type RestoreResourceVersionInput = z.output<typeof restoreResourceVersionSchema>;
export type AppealResourceVersionInput = z.output<typeof appealResourceVersionSchema>;
export type RejectAppealInput = z.output<typeof rejectAppealSchema>;
export type ModerationNotificationStatusInput = z.output<typeof moderationNotificationStatusSchema>;

export type ApplyModerationActionInput = {
  resourceId: string;
  version: number;
  action: ModerationActionType;
  resultingState: ModerationState;
  reasonCode: ModerationReasonCode | ModerationResolutionCode;
  evidenceRefs: ModerationEvidenceReference[];
  reviewerId: string;
  reviewerType: "operator" | "seller" | "system";
  notes: string | null;
  metadata: JsonObject;
  notification: {
    status: ModerationNotificationStatus;
    channel: string;
  } | null;
};

export type ApplyModerationActionResult = {
  action: ResourceModerationAction;
  resource: Resource;
  version: ResourceVersion;
  notification: ModerationNotification | undefined;
};

export type ModerationStore = {
  applyAction: (input: ApplyModerationActionInput) => Promise<ApplyModerationActionResult>;
  listActions: (resourceId: string, version?: number) => Promise<ResourceModerationAction[]>;
  listNotifications: (resourceId: string) => Promise<ModerationNotification[]>;
  updateNotification: (
    notificationId: string,
    update: {
      status: ModerationNotificationStatus;
      notifiedAt: string | null;
      failureReason: string | null;
    }
  ) => Promise<ModerationNotification>;
};

export class InMemoryModerationStore implements ModerationStore {
  private readonly actions: ResourceModerationAction[] = [];
  private readonly notifications: ModerationNotification[] = [];

  constructor(private readonly resourceStore: ResourceStore) {}

  async applyAction(input: ApplyModerationActionInput) {
    const reasonCode = quarantineReason(input);
    const { resource, version } = await this.resourceStore.updateVersionModeration(
      input.resourceId,
      input.version,
      {
        moderationState: input.resultingState,
        ...(reasonCode === undefined ? {} : { quarantineReasonCode: reasonCode }),
        quarantinedAt: input.resultingState === "visible" ? null : new Date().toISOString()
      }
    );

    const now = new Date().toISOString();
    const action: ResourceModerationAction = {
      id: `moderation_action_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      resourceId: input.resourceId,
      versionId: version.id,
      version: input.version,
      action: input.action,
      resultingState: input.resultingState,
      reasonCode: input.reasonCode,
      evidenceRefs: input.evidenceRefs,
      reviewerId: input.reviewerId,
      reviewerType: input.reviewerType,
      notes: input.notes,
      metadata: input.metadata,
      createdAt: now
    };
    this.actions.push(action);

    let notification: ModerationNotification | undefined;
    if (input.notification !== null) {
      notification = {
        id: `moderation_notification_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        actionId: action.id,
        sellerId: resource.sellerId,
        resourceId: resource.id,
        status: input.notification.status,
        channel: input.notification.channel,
        notifiedAt: input.notification.status === "notified" ? now : null,
        failureReason: null,
        createdAt: now,
        updatedAt: now
      };
      this.notifications.push(notification);
    }

    return { action, resource, version, notification };
  }

  async listActions(resourceId: string, version?: number) {
    return this.actions
      .filter(
        (action) =>
          action.resourceId === resourceId && (version === undefined || action.version === version)
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listNotifications(resourceId: string) {
    return this.notifications
      .filter((notification) => notification.resourceId === resourceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async updateNotification(
    notificationId: string,
    update: {
      status: ModerationNotificationStatus;
      notifiedAt: string | null;
      failureReason: string | null;
    }
  ) {
    const index = this.notifications.findIndex(
      (notification) => notification.id === notificationId
    );
    const existing = this.notifications[index];
    if (existing === undefined) {
      throw new LumenError("RESOURCE_NOT_FOUND", "Moderation notification was not found.");
    }
    const updated: ModerationNotification = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString()
    };
    this.notifications[index] = updated;
    return updated;
  }
}

export class PrismaModerationStore implements ModerationStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly resourceStore: ResourceStore
  ) {}

  async applyAction(input: ApplyModerationActionInput) {
    const createdAt = new Date();
    const reasonCode = quarantineReason(input);
    const result = await this.db.$transaction(async (tx) => {
      const resource = await tx.resource.findUnique({ where: { id: input.resourceId } });
      if (resource === null) {
        throw new LumenError("RESOURCE_NOT_FOUND", "Resource was not found.");
      }

      const existingVersion = await tx.resourceVersion.findFirst({
        where: { resourceId: input.resourceId, version: input.version }
      });
      if (existingVersion === null) {
        throw new LumenError("RESOURCE_VERSION_NOT_FOUND", "Resource version was not found.");
      }

      const versionRow = await tx.resourceVersion.update({
        where: { id: existingVersion.id },
        data: {
          moderationState: input.resultingState,
          ...(reasonCode === undefined ? {} : { quarantineReasonCode: reasonCode }),
          quarantinedAt: input.resultingState === "visible" ? null : createdAt
        }
      });

      const latest = await tx.resourceVersion.findFirst({
        where: { resourceId: input.resourceId },
        orderBy: { version: "desc" }
      });
      const isLatestVersion = latest?.version === input.version;
      if (isLatestVersion) {
        await tx.resource.update({
          where: { id: input.resourceId },
          data: { moderationState: input.resultingState }
        });
        await tx.searchDocument.updateMany({
          where: { resourceId: input.resourceId },
          data: { moderationState: input.resultingState, stale: true }
        });
      }

      const actionRow = await tx.resourceModerationAction.create({
        data: {
          resourceId: input.resourceId,
          versionId: versionRow.id,
          version: input.version,
          action: input.action,
          resultingState: input.resultingState,
          reasonCode: input.reasonCode,
          evidenceRefs: input.evidenceRefs as unknown as Prisma.InputJsonValue,
          reviewerId: input.reviewerId,
          reviewerType: input.reviewerType,
          notes: input.notes,
          metadata: input.metadata as unknown as Prisma.InputJsonValue,
          createdAt
        }
      });

      const notificationRow =
        input.notification === null
          ? null
          : await tx.moderationNotification.create({
              data: {
                actionId: actionRow.id,
                sellerId: resource.sellerId,
                resourceId: resource.id,
                status: input.notification.status,
                channel: input.notification.channel,
                notifiedAt: input.notification.status === "notified" ? createdAt : null
              }
            });

      return {
        action: mapModerationAction(actionRow),
        notification:
          notificationRow === null ? undefined : mapModerationNotification(notificationRow)
      };
    });

    const resource = await this.resourceStore.getResource(input.resourceId);
    const version = await this.resourceStore.getVersion(input.resourceId, input.version);
    if (resource === undefined || version === undefined) {
      throw new LumenError("INTERNAL_ERROR", "Moderation state could not be reloaded.");
    }

    return { ...result, resource, version };
  }

  async listActions(resourceId: string, version?: number) {
    const rows = await this.db.resourceModerationAction.findMany({
      where: { resourceId, ...(version === undefined ? {} : { version }) },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapModerationAction);
  }

  async listNotifications(resourceId: string) {
    const rows = await this.db.moderationNotification.findMany({
      where: { resourceId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapModerationNotification);
  }

  async updateNotification(
    notificationId: string,
    update: {
      status: ModerationNotificationStatus;
      notifiedAt: string | null;
      failureReason: string | null;
    }
  ) {
    const row = await this.db.moderationNotification.update({
      where: { id: notificationId },
      data: {
        status: update.status,
        notifiedAt: update.notifiedAt === null ? null : new Date(update.notifiedAt),
        failureReason: update.failureReason
      }
    });
    return mapModerationNotification(row);
  }
}

export class ModerationService {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly store: ModerationStore,
    private readonly auditLogService?: AuditLogService
  ) {}

  async quarantineVersion(resourceId: string, version: number, input: unknown) {
    const body = quarantineResourceVersionSchema.parse(input);
    const target = await this.resourceService.getResourceVersion(resourceId, version);
    if (target.moderationState === "quarantined") {
      throw new LumenError("CONFLICT", "Resource version is already quarantined.");
    }

    const result = await this.store.applyAction({
      resourceId,
      version,
      action: "quarantine",
      resultingState: "quarantined",
      reasonCode: body.reasonCode,
      evidenceRefs: body.evidenceRefs,
      reviewerId: body.reviewerId,
      reviewerType: "operator",
      notes: body.notes ?? null,
      metadata: {
        notifySeller: body.notifySeller,
        source: "operator_api"
      },
      notification: {
        status: body.notifySeller ? "pending" : "not_required",
        channel: "in_app"
      }
    });

    await this.auditLogService?.record({
      action: "resource.quarantined",
      actorType: "system",
      actorId: body.reviewerId,
      targetType: "resource_version",
      targetId: result.version.id,
      metadata: {
        resourceId,
        version,
        reasonCode: body.reasonCode,
        evidenceCount: body.evidenceRefs.length,
        moderationActionId: result.action.id,
        sellerNotificationStatus: result.notification?.status ?? "not_required"
      }
    });

    return this.buildView(result.resource);
  }

  async restoreVersion(resourceId: string, version: number, input: unknown) {
    const body = restoreResourceVersionSchema.parse(input);
    const target = await this.resourceService.getResourceVersion(resourceId, version);
    if (target.moderationState === "visible") {
      throw new LumenError("CONFLICT", "Resource version is not quarantined.");
    }

    const result = await this.store.applyAction({
      resourceId,
      version,
      action: "restore",
      resultingState: "visible",
      reasonCode: body.reasonCode,
      evidenceRefs: body.evidenceRefs,
      reviewerId: body.reviewerId,
      reviewerType: "operator",
      notes: body.notes ?? null,
      metadata: {
        notifySeller: body.notifySeller,
        source: "operator_api"
      },
      notification: {
        status: body.notifySeller ? "pending" : "not_required",
        channel: "in_app"
      }
    });

    await this.auditLogService?.record({
      action: "resource.moderation_restored",
      actorType: "system",
      actorId: body.reviewerId,
      targetType: "resource_version",
      targetId: result.version.id,
      metadata: {
        resourceId,
        version,
        reasonCode: body.reasonCode,
        moderationActionId: result.action.id
      }
    });

    return this.buildView(result.resource);
  }

  async submitAppeal(
    resourceId: string,
    version: number,
    input: unknown,
    sellerContext?: { sellerId: string; auditable: boolean }
  ) {
    const resource = await this.resourceService.getResource(resourceId);
    if (sellerContext?.auditable && resource.sellerId !== sellerContext.sellerId) {
      await this.auditLogService?.record({
        action: "resource.ownership_denied",
        actorType: "seller",
        actorId: sellerContext.sellerId,
        targetType: "resource",
        targetId: resourceId,
        metadata: {
          reason: "Attempted to appeal moderation action for a different seller",
          attemptedOperation: "appeal",
          targetVersion: version,
          actualOwnerId: resource.sellerId
        }
      });
      throw new LumenError("FORBIDDEN", "API key does not own this resource.");
    }

    const body = appealResourceVersionSchema.parse(input);
    const target = await this.resourceService.getResourceVersion(resourceId, version);
    if (target.moderationState !== "quarantined") {
      throw new LumenError("CONFLICT", "Only a quarantined resource version can be appealed.");
    }

    const sellerId = sellerContext?.sellerId ?? resource.sellerId;
    const result = await this.store.applyAction({
      resourceId,
      version,
      action: "appeal",
      resultingState: "under_appeal",
      reasonCode: "other",
      evidenceRefs: body.evidenceRefs,
      reviewerId: sellerId,
      reviewerType: "seller",
      notes: body.message,
      metadata: {
        message: body.message,
        source: "seller_api"
      },
      notification: null
    });

    await this.auditLogService?.record({
      action: "resource.moderation_appealed",
      actorType: "seller",
      actorId: sellerId,
      targetType: "resource_version",
      targetId: result.version.id,
      metadata: {
        resourceId,
        version,
        evidenceCount: body.evidenceRefs.length,
        moderationActionId: result.action.id
      }
    });

    return this.buildView(result.resource);
  }

  async rejectAppeal(resourceId: string, version: number, input: unknown) {
    const body = rejectAppealSchema.parse(input);
    const target = await this.resourceService.getResourceVersion(resourceId, version);
    if (target.moderationState !== "under_appeal") {
      throw new LumenError("CONFLICT", "Resource version is not under appeal.");
    }

    const result = await this.store.applyAction({
      resourceId,
      version,
      action: "reject_appeal",
      resultingState: "quarantined",
      reasonCode: body.reasonCode,
      evidenceRefs: body.evidenceRefs,
      reviewerId: body.reviewerId,
      reviewerType: "operator",
      notes: body.notes ?? null,
      metadata: {
        notifySeller: body.notifySeller,
        source: "operator_api"
      },
      notification: {
        status: body.notifySeller ? "pending" : "not_required",
        channel: "in_app"
      }
    });

    await this.auditLogService?.record({
      action: "resource.moderation_appeal_rejected",
      actorType: "system",
      actorId: body.reviewerId,
      targetType: "resource_version",
      targetId: result.version.id,
      metadata: {
        resourceId,
        version,
        reasonCode: body.reasonCode,
        moderationActionId: result.action.id
      }
    });

    return this.buildView(result.resource);
  }

  async markNotificationStatus(notificationId: string, input: unknown) {
    const body = moderationNotificationStatusSchema.parse(input);
    const notification = await this.store.updateNotification(notificationId, {
      status: body.status,
      notifiedAt: body.status === "notified" ? new Date().toISOString() : null,
      failureReason: body.status === "failed" ? (body.failureReason ?? "Delivery failed") : null
    });

    await this.auditLogService?.record({
      action: "resource.moderation_notification_updated",
      actorType: "system",
      actorId: body.reviewerId,
      targetType: "moderation_notification",
      targetId: notification.id,
      metadata: {
        resourceId: notification.resourceId,
        actionId: notification.actionId,
        status: notification.status
      }
    });

    return notification;
  }

  async getOperatorView(resourceId: string) {
    return this.buildView(await this.resourceService.getResource(resourceId));
  }

  async getSellerView(sellerId: string, resourceId: string) {
    const resource = await this.resourceService.getResource(resourceId);
    if (resource.sellerId !== sellerId) {
      throw new LumenError("FORBIDDEN", "Resource does not belong to this seller.");
    }
    return this.buildView(resource);
  }

  private async buildView(resource: Resource): Promise<ResourceModerationView> {
    const latest = await this.resourceService.getStore().getLatestVersion(resource.id);
    const actions = await this.store.listActions(resource.id);
    const notifications = await this.store.listNotifications(resource.id);
    const latestNotification = notifications.at(-1);
    const latestQuarantine =
      latest !== undefined && latest.moderationState !== "visible"
        ? {
            version: latest.version,
            reasonCode: latest.quarantineReasonCode,
            quarantinedAt: latest.quarantinedAt
          }
        : null;

    return {
      resourceId: resource.id,
      sellerId: resource.sellerId,
      resourceStatus: resource.status,
      moderationState: resource.moderationState,
      discoveryState: discoveryState(resource),
      latestVersion: latest?.version ?? null,
      quarantine: latestQuarantine,
      notificationStatus: latestNotification?.status ?? null,
      appealable: resource.moderationState === "quarantined",
      actions,
      notifications
    };
  }
}

function discoveryState(resource: Resource): ResourceDiscoveryState {
  if (resource.moderationState !== "visible") {
    return "quarantined";
  }
  if (resource.status === "inactive") {
    return "outage";
  }
  if (resource.status === "draft") {
    return "draft";
  }
  return "discoverable";
}

function quarantineReason(
  input: ApplyModerationActionInput
): ModerationReasonCode | null | undefined {
  if (input.resultingState === "visible") {
    return null;
  }
  if (input.action === "appeal") {
    return undefined;
  }
  return input.reasonCode as ModerationReasonCode;
}

function mapModerationAction(row: {
  id: string;
  resourceId: string;
  versionId: string;
  version: number;
  action: string;
  resultingState: string;
  reasonCode: string;
  evidenceRefs: unknown;
  reviewerId: string;
  reviewerType: string;
  notes: string | null;
  metadata: unknown;
  createdAt: Date;
}): ResourceModerationAction {
  return {
    id: row.id,
    resourceId: row.resourceId,
    versionId: row.versionId,
    version: row.version,
    action: row.action as ModerationActionType,
    resultingState: row.resultingState as ModerationState,
    reasonCode: row.reasonCode as ModerationReasonCode | ModerationResolutionCode,
    evidenceRefs: row.evidenceRefs as ModerationEvidenceReference[],
    reviewerId: row.reviewerId,
    reviewerType: row.reviewerType as ResourceModerationAction["reviewerType"],
    notes: row.notes,
    metadata: row.metadata as JsonObject,
    createdAt: row.createdAt.toISOString()
  };
}

function mapModerationNotification(row: {
  id: string;
  actionId: string;
  sellerId: string;
  resourceId: string;
  status: string;
  channel: string;
  notifiedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ModerationNotification {
  return {
    id: row.id,
    actionId: row.actionId,
    sellerId: row.sellerId,
    resourceId: row.resourceId,
    status: row.status as ModerationNotificationStatus,
    channel: row.channel,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
