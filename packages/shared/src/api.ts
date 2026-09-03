import { type ErrorCode } from "./errors.js";

export type RequestId = string;

export type ApiErrorBody = {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  requestId?: RequestId;
};

export type ApiFailure = {
  ok: false;
  error: ApiErrorBody;
  requestId?: RequestId;
};

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export function success<T>(data: T, requestId?: RequestId): ApiSuccess<T> {
  return requestId === undefined ? { ok: true, data } : { ok: true, data, requestId };
}

export function failure(error: ApiErrorBody, requestId?: RequestId): ApiFailure {
  return requestId === undefined ? { ok: false, error } : { ok: false, error, requestId };
}
