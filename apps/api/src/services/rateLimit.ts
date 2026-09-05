import { createHash, randomUUID } from "node:crypto";

export type RateLimitScope = "discovery" | "facilitator" | "seller";

export type RateLimitRule = {
  limit: number;
  windowMs: number;
};

export type RateLimitRequest = {
  key: string;
  route: string;
  scope: RateLimitScope;
};

export type RateLimitResult = {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  resetAt: Date;
  scope: RateLimitScope;
};

export type RateLimitEvent = {
  createdAt: string;
  id: string;
  key: string;
  limit: number;
  remaining: number;
  resetAt: string;
  route: string;
  scope: RateLimitScope;
};

export type RateLimitEventStore = {
  create: (input: Omit<RateLimitEvent, "id" | "createdAt">) => Promise<RateLimitEvent>;
  list: () => Promise<RateLimitEvent[]>;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimitEventStore implements RateLimitEventStore {
  private readonly events: RateLimitEvent[] = [];

  async create(input: Omit<RateLimitEvent, "id" | "createdAt">) {
    const event: RateLimitEvent = {
      id: `rate_limit_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      ...input,
      createdAt: new Date().toISOString()
    };

    this.events.push(event);
    return event;
  }

  async list() {
    return [...this.events];
  }
}

export class RateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly eventStore: RateLimitEventStore;
  private readonly rules: Record<RateLimitScope, RateLimitRule>;

  constructor(
    options: {
      eventStore?: RateLimitEventStore;
      rules?: Partial<Record<RateLimitScope, RateLimitRule>>;
    } = {}
  ) {
    this.eventStore = options.eventStore ?? new InMemoryRateLimitEventStore();
    this.rules = {
      discovery: {
        limit: 120,
        windowMs: 60_000
      },
      facilitator: {
        limit: 60,
        windowMs: 60_000
      },
      seller: {
        limit: 30,
        windowMs: 60_000
      },
      ...options.rules
    };
  }

  async consume(request: RateLimitRequest): Promise<RateLimitResult> {
    const rule = this.rules[request.scope];
    const now = Date.now();
    const key = hashRateLimitKey(`${request.scope}:${request.key}`);
    const bucketKey = `${request.scope}:${key}`;
    const existing = this.buckets.get(bucketKey);
    const bucket =
      existing === undefined || existing.resetAt <= now
        ? { count: 0, resetAt: now + rule.windowMs }
        : existing;

    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);

    const remaining = Math.max(0, rule.limit - bucket.count);
    const result: RateLimitResult = {
      allowed: bucket.count <= rule.limit,
      key,
      limit: rule.limit,
      remaining,
      resetAt: new Date(bucket.resetAt),
      scope: request.scope
    };

    if (!result.allowed) {
      await this.eventStore.create({
        key,
        limit: rule.limit,
        remaining,
        resetAt: result.resetAt.toISOString(),
        route: request.route,
        scope: request.scope
      });
    }

    return result;
  }

  async listEvents() {
    return this.eventStore.list();
  }
}

export function createRateLimitService(
  rules?: Partial<Record<RateLimitScope, RateLimitRule>>
): RateLimitService {
  return rules === undefined ? new RateLimitService() : new RateLimitService({ rules });
}

function hashRateLimitKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}
