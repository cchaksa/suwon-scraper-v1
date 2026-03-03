import { createHash } from "crypto";
import type { WorkerJobInput } from "../types/worker";

export interface InvalidPayloadDetails {
  reason: string;
  hasValidJobId: boolean;
  jobId?: string;
}

export interface ValidationSuccess {
  ok: true;
  value: WorkerJobInput;
}

export interface ValidationFailure {
  ok: false;
  error: InvalidPayloadDetails;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

function isObjectRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isIsoDateString(input: string): boolean {
  return !Number.isNaN(Date.parse(input));
}

function asTrimmedString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractRequestPayload(input: unknown): { username: string; password: string; raw: Record<string, unknown> } | null {
  if (!isObjectRecord(input)) return null;
  const username = asTrimmedString(input.username);
  const password = asTrimmedString(input.password);
  if (!username || !password) return null;
  return {
    username,
    password,
    raw: input,
  };
}

export function validateWorkerJobInput(input: unknown): ValidationResult {
  if (!isObjectRecord(input)) {
    return {
      ok: false,
      error: { reason: "payload must be a JSON object", hasValidJobId: false },
    };
  }

  const jobId = asTrimmedString(input.job_id);
  const hasValidJobId = Boolean(jobId);

  const userId = asTrimmedString(input.user_id);
  if (!userId) {
    return {
      ok: false,
      error: { reason: "user_id is required", hasValidJobId, jobId: jobId ?? undefined },
    };
  }

  const portalType = asTrimmedString(input.portal_type);
  if (portalType !== "suwon") {
    return {
      ok: false,
      error: { reason: "portal_type must be suwon", hasValidJobId, jobId: jobId ?? undefined },
    };
  }

  const requestPayload = extractRequestPayload(input.request_payload);
  if (!requestPayload) {
    return {
      ok: false,
      error: { reason: "request_payload.username and request_payload.password are required", hasValidJobId, jobId: jobId ?? undefined },
    };
  }

  const requestedAt = asTrimmedString(input.requested_at);
  if (!requestedAt || !isIsoDateString(requestedAt)) {
    return {
      ok: false,
      error: { reason: "requested_at must be an ISO date string", hasValidJobId, jobId: jobId ?? undefined },
    };
  }

  if (!jobId) {
    return {
      ok: false,
      error: { reason: "job_id is required", hasValidJobId: false },
    };
  }

  return {
    ok: true,
    value: {
      job_id: jobId,
      user_id: userId,
      portal_type: "suwon",
      request_payload: requestPayload.raw as WorkerJobInput["request_payload"],
      requested_at: requestedAt,
    },
  };
}

export function parseJsonPayload(rawBody: string): unknown {
  return JSON.parse(rawBody);
}

export function hashRawPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
