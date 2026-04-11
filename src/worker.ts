import { CallbackClient } from "./services/callbackClient";
import { classifyWorkerError } from "./services/errorClassifier";
import { hashRawPayload, parseJsonPayload, validateWorkerJobInput } from "./services/payloadValidator";
import {
  createResultStorageClient,
  type ResultStorageClient,
  type StoredResultDescriptor,
} from "./services/resultStorage";
import { scrapeJob } from "./services/scrapeJob";
import { createSqsInputClient, type SqsInputClient } from "./services/sqsInput";
import { logger } from "./utils/logger";
import type { WorkerCallbackPayload, WorkerFailureResult, WorkerJobInput, WorkerSuccessResult } from "./types/worker";

type InputSourceType = "env" | "argv" | "sqs-poll";
type WorkerInputMode = "auto" | "pipe";

interface ResolvedInput {
  source: InputSourceType;
  rawMessage: string;
  sqsMessageId?: string;
  receiptHandle?: string;
}

export interface WorkerConfig {
  portalTimeoutMs: number;
  totalTimeoutMs: number;
  gracefulShutdownMs: number;
  callbackTimeoutMs: number;
  callbackMaxRetries: number;
  callbackBaseUrl: string;
  callbackSecret: string;
  resultBucket: string;
  resultPrefix: string;
  resultStorageClass: string;
  resultSseKmsKeyArn?: string;
  resultRetentionDays?: number;
  resultRegion: string;
  sqsMessageBody?: string;
  sqsMessageId?: string;
  sqsQueueUrl?: string;
  sqsPollWaitTimeSeconds: number;
  sqsPollVisibilityTimeoutSeconds: number;
  awsRegion: string;
  inputMode: WorkerInputMode;
}

export interface WorkerRuntimeDeps {
  now: () => Date;
  callbackClient: CallbackClient;
  scrapeFn: typeof scrapeJob;
  sqsInputClient: SqsInputClient;
  resultStorage: ResultStorageClient;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseInputMode(raw: string | undefined): WorkerInputMode {
  return raw === "pipe" ? "pipe" : "auto";
}

function loadConfigFromEnv(): WorkerConfig {
  return {
    portalTimeoutMs: parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000),
    totalTimeoutMs: parsePositiveNumber(process.env.WORKER_TOTAL_TIMEOUT_MS, 120000),
    gracefulShutdownMs: parsePositiveNumber(process.env.WORKER_GRACEFUL_SHUTDOWN_MS, 10000),
    callbackTimeoutMs: parsePositiveNumber(process.env.SCRAPE_CALLBACK_TIMEOUT_MS, 60000),
    callbackMaxRetries: parsePositiveNumber(process.env.SCRAPE_CALLBACK_MAX_RETRIES, 3),
    callbackBaseUrl: process.env.SCRAPE_CALLBACK_BASE_URL ?? "",
    callbackSecret: process.env.SCRAPE_CALLBACK_HMAC_SECRET ?? "",
    resultBucket: process.env.SCRAPING_RESULT_BUCKET ?? process.env.SCRAPE_RESULT_BUCKET ?? "",
    resultPrefix: (process.env.SCRAPING_RESULT_PREFIX ?? process.env.SCRAPE_RESULT_PREFIX ?? "scrape-results/").replace(
      /\s+/g,
      ""
    ),
    resultStorageClass: process.env.SCRAPING_RESULT_STORAGE_CLASS ?? process.env.SCRAPE_RESULT_STORAGE_CLASS ?? "STANDARD",
    resultSseKmsKeyArn: process.env.SCRAPING_RESULT_KMS_KEY_ARN ?? process.env.SCRAPE_RESULT_KMS_KEY_ARN,
    resultRetentionDays:
      parsePositiveInt(process.env.SCRAPING_RESULT_RETENTION_DAYS, 0) ||
      parsePositiveInt(process.env.SCRAPE_RESULT_RETENTION_DAYS, 0) ||
      undefined,
    resultRegion:
      process.env.SCRAPING_RESULT_REGION ?? process.env.AWS_REGION ?? process.env.SCRAPE_RESULT_REGION ?? "ap-northeast-2",
    sqsMessageBody: process.env.SQS_MESSAGE_BODY,
    sqsMessageId: process.env.SQS_MESSAGE_ID,
    sqsQueueUrl: process.env.SQS_QUEUE_URL,
    sqsPollWaitTimeSeconds: parsePositiveInt(process.env.SQS_POLL_WAIT_TIME_SECONDS, 10),
    sqsPollVisibilityTimeoutSeconds: parsePositiveInt(process.env.SQS_POLL_VISIBILITY_TIMEOUT_SECONDS, 60),
    awsRegion: process.env.AWS_REGION ?? "ap-northeast-2",
    inputMode: parseInputMode(process.env.WORKER_INPUT_MODE),
  };
}

function createRuntimeDeps(config: WorkerConfig): WorkerRuntimeDeps {
  const callbackClient = new CallbackClient({
    baseUrl: config.callbackBaseUrl,
    secret: config.callbackSecret,
    timeoutMs: config.callbackTimeoutMs,
    maxRetries: config.callbackMaxRetries,
    logger,
  });

  return {
    now: () => new Date(),
    callbackClient,
    scrapeFn: scrapeJob,
    sqsInputClient: createSqsInputClient(config.awsRegion),
    resultStorage: createResultStorageClient({
      bucket: config.resultBucket,
      prefix: config.resultPrefix,
      region: config.resultRegion,
      storageClass: config.resultStorageClass,
      kmsKeyArn: config.resultSseKmsKeyArn,
      retentionDays: config.resultRetentionDays,
    }),
  };
}

function ensureCallbackConfig(config: WorkerConfig): void {
  if (!config.callbackBaseUrl) {
    throw new Error("SCRAPE_CALLBACK_BASE_URL 환경변수가 필요합니다.");
  }
  if (!config.callbackSecret) {
    throw new Error("SCRAPE_CALLBACK_HMAC_SECRET 환경변수가 필요합니다.");
  }
  if (!config.resultBucket) {
    throw new Error("SCRAPING_RESULT_BUCKET 환경변수가 필요합니다.");
  }
}

async function resolveInputSource(config: WorkerConfig, deps: WorkerRuntimeDeps, argvMessage?: string): Promise<ResolvedInput> {
  const envMessage = config.sqsMessageBody?.trim();
  if (envMessage) {
    return {
      source: "env",
      rawMessage: envMessage,
      sqsMessageId: config.sqsMessageId,
    };
  }

  const argMessage = argvMessage?.trim();
  if (argMessage) {
    return {
      source: "argv",
      rawMessage: argMessage,
      sqsMessageId: config.sqsMessageId,
    };
  }

  if (config.inputMode === "pipe") {
    throw new Error("INPUT_SOURCE_MISSING: WORKER_INPUT_MODE=pipe 에서는 SQS_MESSAGE_BODY가 필수입니다.");
  }

  const queueUrl = config.sqsQueueUrl?.trim();
  if (!queueUrl) {
    throw new Error("INPUT_SOURCE_MISSING: SQS_QUEUE_URL 또는 입력 메시지를 제공하세요.");
  }

  const received = await deps.sqsInputClient.receiveOne({
    queueUrl,
    waitTimeSeconds: config.sqsPollWaitTimeSeconds,
    visibilityTimeoutSeconds: config.sqsPollVisibilityTimeoutSeconds,
  });

  if (!received) {
    throw new Error("INPUT_SOURCE_MISSING: 큐에서 처리할 메시지를 찾지 못했습니다.");
  }

  return {
    source: "sqs-poll",
    rawMessage: received.body,
    sqsMessageId: received.messageId,
    receiptHandle: received.receiptHandle,
  };
}

function toIso(now: Date): string {
  return now.toISOString();
}

function buildFailurePayload(
  jobId: string,
  now: Date,
  input: { error_code: WorkerFailureResult["error_code"]; error_message: string; retryable: boolean }
): WorkerFailureResult {
  return {
    job_id: jobId,
    status: "failed",
    error_code: input.error_code,
    error_message: input.error_message,
    retryable: input.retryable,
    finished_at: toIso(now),
  };
}

function buildSuccessPayload(
  jobId: string,
  now: Date,
  descriptor: StoredResultDescriptor,
  requestedAt?: string
): WorkerSuccessResult {
  return {
    job_id: jobId,
    status: "succeeded",
    result_s3_key: descriptor.key,
    result_checksum: descriptor.checksum,
    metadata: {
      bucket: descriptor.bucket,
      content_length: descriptor.contentLength,
      stored_at: descriptor.storedAt,
      storage_class: descriptor.storageClass,
      upload_attempt: descriptor.attempt,
      requested_at: requestedAt,
      retention_days: descriptor.retentionDays,
    },
    finished_at: toIso(now),
  };
}

function successResultMeta(payload: WorkerCallbackPayload): Record<string, unknown> {
  if (payload.status !== "succeeded") {
    return {};
  }
  return {
    result_s3_key: payload.result_s3_key,
    result_checksum: payload.result_checksum,
  };
}

async function sendCallbackWithOptionalFinalAttempt(
  deps: WorkerRuntimeDeps,
  payload: WorkerCallbackPayload,
  options: { shutdownRequested: boolean }
): Promise<boolean> {
  try {
    await deps.callbackClient.send(payload);
    return true;
  } catch (error) {
    logger.error("콜백 전송 실패", {
      job_id: payload.job_id,
      error: error instanceof Error ? error.message : String(error),
      status: payload.status,
      ...successResultMeta(payload),
    });

    if (!options.shutdownRequested) {
      return false;
    }

    logger.info("종료 전 마지막 콜백 1회 시도", { job_id: payload.job_id });
    try {
      await deps.callbackClient.send(payload, { maxRetriesOverride: 0 });
      return true;
    } catch (finalError) {
      logger.error("마지막 콜백 시도 실패", {
        job_id: payload.job_id,
        error: finalError instanceof Error ? finalError.message : String(finalError),
        ...successResultMeta(payload),
      });
      return false;
    }
  }
}

async function handleValidatedJob(
  input: WorkerJobInput,
  deps: WorkerRuntimeDeps,
  config: WorkerConfig,
  abortSignal: AbortSignal,
  startedAtMs: number
): Promise<number> {
  let callbackPayload: WorkerCallbackPayload | null = null;
  let succeeded = false;
  let successDescriptor: StoredResultDescriptor | null = null;
  let failedMeta: { error_code: string; retryable: boolean; error_message: string } | null = null;
  try {
    const result = await deps.scrapeFn({
      username: input.request_payload.username,
      password: input.request_payload.password,
      portalTimeoutMs: config.portalTimeoutMs,
      abortSignal,
      jobId: input.job_id,
    });
    successDescriptor = await deps.resultStorage.put({
      jobId: input.job_id,
      requestedAt: input.requested_at,
      payload: result,
      attempt: 1,
    });
    callbackPayload = buildSuccessPayload(input.job_id, deps.now(), successDescriptor, input.requested_at);
    succeeded = true;
  } catch (error) {
    const classified = classifyWorkerError(error);
    failedMeta = classified;
    callbackPayload = buildFailurePayload(input.job_id, deps.now(), classified);
  }

  if (!callbackPayload) return 1;
  const callbackSent = await sendCallbackWithOptionalFinalAttempt(deps, callbackPayload, {
    shutdownRequested: abortSignal.aborted,
  });
  if (!callbackSent) {
    logger.error("job.failed", {
      job_id: input.job_id,
      sqs_message_id: config.sqsMessageId ?? null,
      duration_ms: Date.now() - startedAtMs,
      error_code: "CALLBACK_DELIVERY_FAILED",
      retryable: true,
      error_message: "콜백 전송 실패",
      ...successResultMeta(callbackPayload),
    });
    return 1;
  }

  if (succeeded) {
    logger.info("job.succeeded", {
      job_id: input.job_id,
      sqs_message_id: config.sqsMessageId ?? null,
      duration_ms: Date.now() - startedAtMs,
      result_s3_key: successDescriptor?.key ?? null,
    });
    return 0;
  }

  logger.error("job.failed", {
    job_id: input.job_id,
    sqs_message_id: config.sqsMessageId ?? null,
    duration_ms: Date.now() - startedAtMs,
    error_code: failedMeta?.error_code ?? "UNKNOWN_NON_RETRYABLE",
    retryable: failedMeta?.retryable ?? false,
    error_message: failedMeta?.error_message ?? "작업 실패",
  });
  return 1;
}

export async function runWorkerMessage(
  rawMessage: string,
  config: WorkerConfig,
  deps: WorkerRuntimeDeps,
  externalAbortSignal?: AbortSignal
): Promise<number> {
  const startedAtMs = Date.now();
  const abortController = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  let onExternalAbort: (() => void) | null = null;

  try {
    timeoutId = setTimeout(() => {
      abortController.abort();
      logger.error("전체 작업 타임아웃 발생", { timeout_ms: config.totalTimeoutMs });
    }, config.totalTimeoutMs);

    if (externalAbortSignal) {
      if (externalAbortSignal.aborted) {
        abortController.abort();
      } else {
        onExternalAbort = () => abortController.abort();
        externalAbortSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    const parsed = (() => {
      try {
        return parseJsonPayload(rawMessage);
      } catch (error) {
        logger.error("job.failed", {
          job_id: null,
          sqs_message_id: config.sqsMessageId ?? null,
          duration_ms: Date.now() - startedAtMs,
          error_code: "INVALID_PAYLOAD",
          reason: error instanceof Error ? error.message : String(error),
          payload_hash: hashRawPayload(rawMessage),
        });
        return null;
      }
    })();

    if (!parsed) return 1;

    const validation = validateWorkerJobInput(parsed);
    if (!validation.ok) {
      logger.error("job.failed", {
        job_id: validation.error.jobId ?? null,
        sqs_message_id: config.sqsMessageId ?? null,
        duration_ms: Date.now() - startedAtMs,
        error_code: "INVALID_PAYLOAD",
        reason: validation.error.reason,
        payload_hash: hashRawPayload(rawMessage),
        retryable: false,
      });

      if (!validation.error.hasValidJobId || !validation.error.jobId) {
        return 1;
      }

      const payload = buildFailurePayload(validation.error.jobId, deps.now(), {
        error_code: "INVALID_PAYLOAD",
        error_message: validation.error.reason,
        retryable: false,
      });

      const callbackSent = await sendCallbackWithOptionalFinalAttempt(deps, payload, {
        shutdownRequested: abortController.signal.aborted,
      });
      if (!callbackSent) {
        logger.error("job.failed", {
          job_id: validation.error.jobId,
          sqs_message_id: config.sqsMessageId ?? null,
          duration_ms: Date.now() - startedAtMs,
          error_code: "CALLBACK_DELIVERY_FAILED",
          retryable: true,
          error_message: "콜백 전송 실패",
          ...successResultMeta(payload),
        });
        return 1;
      }
      return 1;
    }

    logger.info("job.started", {
      job_id: validation.value.job_id,
      user_id: validation.value.user_id,
      portal_type: validation.value.portal_type,
      sqs_message_id: config.sqsMessageId ?? null,
    });

    const exitCode = await handleValidatedJob(validation.value, deps, config, abortController.signal, startedAtMs);
    logger.info("job.finished", {
      job_id: validation.value.job_id,
      sqs_message_id: config.sqsMessageId ?? null,
      duration_ms: Date.now() - startedAtMs,
      exit_code: exitCode,
    });
    return exitCode;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (externalAbortSignal && onExternalAbort) {
      externalAbortSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

export async function runWorker(
  config: WorkerConfig,
  deps: WorkerRuntimeDeps,
  options: { argvMessage?: string; externalAbortSignal?: AbortSignal } = {}
): Promise<number> {
  const resolvedInput = await resolveInputSource(config, deps, options.argvMessage);
  const runtimeConfig: WorkerConfig = {
    ...config,
    sqsMessageId: resolvedInput.sqsMessageId ?? config.sqsMessageId,
  };

  const exitCode = await runWorkerMessage(resolvedInput.rawMessage, runtimeConfig, deps, options.externalAbortSignal);

  if (resolvedInput.source === "sqs-poll" && resolvedInput.receiptHandle && config.sqsQueueUrl) {
    if (exitCode === 0) {
      await deps.sqsInputClient.deleteMessage({
        queueUrl: config.sqsQueueUrl,
        receiptHandle: resolvedInput.receiptHandle,
      });
    }
  }

  return exitCode;
}

export async function runWorkerFromEnvironment(argvMessage?: string): Promise<number> {
  const config = loadConfigFromEnv();
  ensureCallbackConfig(config);
  const runtimeDeps = createRuntimeDeps(config);

  try {
    return await runWorker(config, runtimeDeps, { argvMessage });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("INPUT_SOURCE_MISSING")) {
      logger.error("job.failed", {
        job_id: null,
        error_code: "INPUT_SOURCE_MISSING",
        reason: message,
        sqs_message_id: config.sqsMessageId ?? null,
        duration_ms: 0,
      });
      return 1;
    }
    throw error;
  }
}

if (require.main === module) {
  const config = loadConfigFromEnv();
  let forceExitTimer: NodeJS.Timeout | null = null;
  const shutdownController = new AbortController();

  const signalHandler = (signal: NodeJS.Signals) => {
    logger.error("종료 시그널 수신", { signal, graceful_shutdown_ms: config.gracefulShutdownMs });
    shutdownController.abort();
    if (!forceExitTimer) {
      forceExitTimer = setTimeout(() => {
        logger.error("graceful shutdown timeout 초과로 강제 종료");
        process.exit(1);
      }, config.gracefulShutdownMs);
    }
  };

  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  (async () => {
    try {
      ensureCallbackConfig(config);
      const runtimeDeps = createRuntimeDeps(config);
      const exitCode = await runWorker(config, runtimeDeps, {
        argvMessage: process.argv[2],
        externalAbortSignal: shutdownController.signal,
      });
      if (forceExitTimer) clearTimeout(forceExitTimer);
      process.exit(exitCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("INPUT_SOURCE_MISSING")) {
        logger.error("job.failed", {
          job_id: null,
          error_code: "INPUT_SOURCE_MISSING",
          reason: message,
          sqs_message_id: config.sqsMessageId ?? null,
          duration_ms: 0,
        });
      } else {
        logger.error("워커 실행 실패", { error: message });
      }
      if (forceExitTimer) clearTimeout(forceExitTimer);
      process.exit(1);
    } finally {
      process.off("SIGTERM", signalHandler);
      process.off("SIGINT", signalHandler);
    }
  })();
}
