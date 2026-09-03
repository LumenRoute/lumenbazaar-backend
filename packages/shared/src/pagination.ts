export const defaultPageLimit = 25;
export const maxPageLimit = 100;

export type PaginationQuery = {
  cursor?: string;
  limit?: number;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type DecodedCursor = {
  id: string;
  createdAt?: string;
};

export function normalizeLimit(limit: number | undefined) {
  if (limit === undefined || Number.isNaN(limit)) {
    return defaultPageLimit;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), maxPageLimit);
}

export function encodeCursor(cursor: DecodedCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): DecodedCursor | undefined {
  if (cursor === undefined || cursor.length === 0) {
    return undefined;
  }

  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as DecodedCursor;

  if (typeof decoded.id !== "string" || decoded.id.length === 0) {
    throw new LumenCursorError();
  }

  return decoded;
}

export class LumenCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "LumenCursorError";
  }
}
