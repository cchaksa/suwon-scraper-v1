import { CallbackClient } from "./services/callbackClient";
import { classifyWorkerError } from "./services/errorClassifier";
import { hashRawPayload, parseJsonPayload, validateWorkerJobInput } from "./services/payloadValidator";
import { scrapeJob } from "./services/scrapeJob";
import { logger } from "./utils/logger";
import type { WorkerCallbackPayload, WorkerFailureResult, WorkerJobInput, WorkerSuccessResult } from "./types/worker";

export interface WorkerConfig {
  portalTimeoutMs: number;
  totalTimeoutMs: number;
  gracefulShutdownMs: number;
  callbackTimeoutMs: number;
  callbackMaxRetries: number;
  callbackBaseUrl: string;
  callbackSecret: string;
  sqsMessageBody?: string;
  sqsMessageId?: string;
}

export interface WorkerRuntimeDeps {
  now: () => Date;
  callbackClient: CallbackClient;
  scrapeFn: typeof scrapeJob;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadConfigFromEnv(): WorkerConfig {
  return {
    portalTimeoutMs: parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000),
    totalTimeoutMs: parsePositiveNumber(process.env.WORKER_TOTAL_TIMEOUT_MS, 120000),
    gracefulShutdownMs: parsePositiveNumber(process.env.WORKER_GRACEFUL_SHUTDOWN_MS, 10000),
    callbackTimeoutMs: parsePositiveNumber(process.env.SCRAPE_CALLBACK_TIMEOUT_MS, 5000),
    callbackMaxRetries: parsePositiveNumber(process.env.SCRAPE_CALLBACK_MAX_RETRIES, 3),
    callbackBaseUrl: process.env.SCRAPE_CALLBACK_BASE_URL ?? "",
    callbackSecret: process.env.SCRAPE_CALLBACK_HMAC_SECRET ?? "",
    sqsMessageBody: process.env.SQS_MESSAGE_BODY,
    sqsMessageId: process.env.SQS_MESSAGE_ID,
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
  };
}

function ensureCallbackConfig(config: WorkerConfig): void {
  if (!config.callbackBaseUrl) {
    throw new Error("SCRAPE_CALLBACK_BASE_URL 환경변수가 필요합니다.");
  }
  if (!config.callbackSecret) {
    throw new Error("SCRAPE_CALLBACK_HMAC_SECRET 환경변수가 필요합니다.");
  }
}

function resolveRawMessage(config: WorkerConfig): string {
  const envMessage = config.sqsMessageBody?.trim();
  if (envMessage) return envMessage;

  if (process.env.NODE_ENV === "production") {
    throw new Error("운영 환경에서는 SQS_MESSAGE_BODY가 필수입니다. EventBridge Pipe override 구성을 확인하세요.");
  }

  const argvMessage = process.argv[2]?.trim();
  if (argvMessage) return argvMessage;

  throw new Error("입력 메시지를 찾을 수 없습니다. SQS_MESSAGE_BODY 또는 argv[2]를 제공하세요.");
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

function buildSuccessPayload(jobId: string, now: Date, resultPayload: unknown): WorkerSuccessResult {
  return {
    job_id: jobId,
    status: "succeeded",
    result_payload: resultPayload,
    finished_at: toIso(now),
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
      });
      return false;
    }
  }
}

async function handleValidatedJob(
  input: WorkerJobInput,
  deps: WorkerRuntimeDeps,
  config: WorkerConfig,
  abortSignal: AbortSignal
): Promise<number> {
  let callbackPayload: WorkerCallbackPayload | null = null;
  let shutdownRequested = false;

  try {
    const result = await deps.scrapeFn({
      username: input.request_payload.username,
      password: input.request_payload.password,
      portalTimeoutMs: config.portalTimeoutMs,
      abortSignal,
      jobId: input.job_id,
    });
    callbackPayload = buildSuccessPayload(input.job_id, deps.now(), result);
  } catch (error) {
    const classified = classifyWorkerError(error);
    callbackPayload = buildFailurePayload(input.job_id, deps.now(), classified);
    logger.error("스크래핑 작업 실패", {
      job_id: input.job_id,
      error_code: classified.error_code,
      retryable: classified.retryable,
      error_message: classified.error_message,
    });
  }

  if (!callbackPayload) return 1;
  shutdownRequested = abortSignal.aborted;
  const callbackSent = await sendCallbackWithOptionalFinalAttempt(deps, callbackPayload, { shutdownRequested });
  return callbackSent ? 0 : 1;
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
        logger.error("JSON 파싱 실패", {
          error_code: "INVALID_PAYLOAD",
          reason: error instanceof Error ? error.message : String(error),
          payload_hash: hashRawPayload(rawMessage),
          sqs_message_id: config.sqsMessageId ?? null,
        });
        return null;
      }
    })();

    if (!parsed) return 1;

    const validation = validateWorkerJobInput(parsed);
    if (!validation.ok) {
      logger.error("입력 스키마 검증 실패", {
        error_code: "INVALID_PAYLOAD",
        reason: validation.error.reason,
        payload_hash: hashRawPayload(rawMessage),
        sqs_message_id: config.sqsMessageId ?? null,
        job_id: validation.error.jobId ?? null,
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
      return callbackSent ? 0 : 1;
    }

    logger.info("job.started", {
      job_id: validation.value.job_id,
      user_id: validation.value.user_id,
      portal_type: validation.value.portal_type,
      sqs_message_id: config.sqsMessageId ?? null,
    });

    const exitCode = await handleValidatedJob(validation.value, deps, config, abortController.signal);
    const finishedAtMs = Date.now();
    logger.info("job.finished", {
      job_id: validation.value.job_id,
      duration_ms: finishedAtMs - startedAtMs,
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

export async function runWorkerFromEnvironment(): Promise<number> {
  const config = loadConfigFromEnv();
  const runtimeDeps = createRuntimeDeps(config);
  ensureCallbackConfig(config);
  const rawMessage = resolveRawMessage(config);
  return runWorkerMessage(rawMessage, config, runtimeDeps);
}

if (require.main === module) {
  const config = loadConfigFromEnv();
  const runtimeDeps = createRuntimeDeps(config);
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
      const rawMessage = resolveRawMessage(config);

      if (shutdownController.signal.aborted) {
        process.exit(1);
      }

      const exitCode = await runWorkerMessage(rawMessage, config, runtimeDeps, shutdownController.signal);
      if (forceExitTimer) clearTimeout(forceExitTimer);
      process.exit(exitCode);
    } catch (error) {
      logger.error("워커 실행 실패", { error: error instanceof Error ? error.message : String(error) });
      if (forceExitTimer) clearTimeout(forceExitTimer);
      process.exit(1);
    } finally {
      process.off("SIGTERM", signalHandler);
      process.off("SIGINT", signalHandler);
    }
  })();
}
