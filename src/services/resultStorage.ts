import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageClass } from "@aws-sdk/client-s3";
import { hashRawPayload } from "./payloadValidator";
import { logger as defaultLogger } from "../utils/logger";

export interface ResultStorageClientConfig {
  bucket: string;
  prefix: string;
  region: string;
  storageClass: string;
  kmsKeyArn?: string;
  retentionDays?: number;
}

export interface ResultStorageClientDeps {
  s3Client?: S3Client;
  now?: () => Date;
  logger?: typeof defaultLogger;
}

export interface ResultStoragePutParams {
  jobId: string;
  requestedAt?: string;
  payload: unknown;
  attempt: number;
}

export interface StoredResultDescriptor {
  bucket: string;
  key: string;
  checksum: string;
  contentLength: number;
  storedAt: string;
  storageClass: string;
  attempt: number;
  retentionDays?: number;
}

export interface ResultStorageClient {
  put(params: ResultStoragePutParams): Promise<StoredResultDescriptor>;
}

export class ResultStorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ResultStorageError";
  }
}

interface NormalizedConfig {
  bucket: string;
  prefix: string;
  region: string;
  storageClass: StorageClass;
  kmsKeyArn?: string;
  retentionDays?: number;
}

const DEFAULT_PREFIX = "scrape-results/";
const ALLOWED_STORAGE_CLASSES: StorageClass[] = [
  "STANDARD",
  "REDUCED_REDUNDANCY",
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER",
  "DEEP_ARCHIVE",
  "GLACIER_IR",
];

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix || !prefix.trim()) return DEFAULT_PREFIX;
  const trimmed = prefix.trim().replace(/^\/+/, "");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function normalizeStorageClass(storageClass?: string): StorageClass {
  if (!storageClass) return "STANDARD";
  const upper = storageClass.toUpperCase();
  if (ALLOWED_STORAGE_CLASSES.includes(upper as StorageClass)) {
    return upper as StorageClass;
  }
  return "STANDARD";
}

function sanitizeJobIdSegment(jobId: string): string {
  const normalized = jobId.trim();
  if (!normalized) {
    return "unknown-job";
  }
  return normalized.replace(/[^0-9A-Za-z-_]/g, "-");
}

function toCompactTimestamp(source?: string, fallback?: () => Date): string {
  const parsed = source ? new Date(source) : null;
  const baseDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback?.() ?? new Date();
  const yyyy = baseDate.getUTCFullYear().toString().padStart(4, "0");
  const mm = (baseDate.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = baseDate.getUTCDate().toString().padStart(2, "0");
  const hh = baseDate.getUTCHours().toString().padStart(2, "0");
  const mi = baseDate.getUTCMinutes().toString().padStart(2, "0");
  const ss = baseDate.getUTCSeconds().toString().padStart(2, "0");
  const ms = baseDate.getUTCMilliseconds().toString().padStart(3, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}${ms}`;
}

function buildKey(config: NormalizedConfig, jobId: string, timestamp: string): string {
  return `${config.prefix}${sanitizeJobIdSegment(jobId)}/${timestamp}.json`;
}

export function createResultStorageClient(
  config: ResultStorageClientConfig,
  deps: ResultStorageClientDeps = {}
): ResultStorageClient {
  const normalizedConfig: NormalizedConfig = {
    bucket: config.bucket,
    prefix: normalizePrefix(config.prefix),
    region: config.region,
    storageClass: normalizeStorageClass(config.storageClass),
    kmsKeyArn: config.kmsKeyArn,
    retentionDays: config.retentionDays,
  };
  const s3 = deps.s3Client ?? new S3Client({ region: normalizedConfig.region });
  const nowFn = deps.now ?? (() => new Date());
  const log = deps.logger ?? defaultLogger;

  return {
    async put(params: ResultStoragePutParams): Promise<StoredResultDescriptor> {
      const storedAt = nowFn();
      const key = buildKey(normalizedConfig, params.jobId, toCompactTimestamp(params.requestedAt, nowFn));
      const body = JSON.stringify(params.payload);
      const checksum = hashRawPayload(body);
      const command = new PutObjectCommand({
        Bucket: normalizedConfig.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        StorageClass: normalizedConfig.storageClass,
        ServerSideEncryption: normalizedConfig.kmsKeyArn ? "aws:kms" : "AES256",
        ...(normalizedConfig.kmsKeyArn ? { SSEKMSKeyId: normalizedConfig.kmsKeyArn } : {}),
        Metadata: {
          job_id: params.jobId,
          requested_at: params.requestedAt ?? "",
          checksum,
          retention_days: normalizedConfig.retentionDays ? String(normalizedConfig.retentionDays) : "",
        },
      });

      try {
        await s3.send(command);
        const descriptor: StoredResultDescriptor = {
          bucket: normalizedConfig.bucket,
          key,
          checksum,
          contentLength: Buffer.byteLength(body),
          storedAt: storedAt.toISOString(),
          storageClass: normalizedConfig.storageClass,
          attempt: params.attempt,
          retentionDays: normalizedConfig.retentionDays,
        };
        log.info("result_storage.upload.success", {
          job_id: params.jobId,
          s3_key: key,
          attempt: params.attempt,
          checksum,
          content_length: descriptor.contentLength,
        });
        return descriptor;
      } catch (error) {
        log.error("result_storage.upload.failed", {
          job_id: params.jobId,
          s3_key: key,
          attempt: params.attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ResultStorageError(error instanceof Error ? error.message : String(error), error);
      }
    },
  };
}
