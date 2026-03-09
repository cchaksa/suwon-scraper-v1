import { createHmac } from "crypto";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { URL } from "url";
import { logger as defaultLogger } from "../utils/logger";
import type { WorkerCallbackPayload } from "../types/worker";

export interface CallbackAttemptResult {
  statusCode: number;
  body: string;
}

export interface CallbackClientOptions {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  maxRetries: number;
  logger?: typeof defaultLogger;
  sleepFn?: (ms: number) => Promise<void>;
  postFn?: (url: string, body: string, headers: Record<string, string>, timeoutMs: number) => Promise<CallbackAttemptResult>;
}

export interface CallbackSendOptions {
  maxRetriesOverride?: number;
}

export function buildCanonicalString(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

export function buildSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(buildCanonicalString(timestamp, rawBody)).digest("hex");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode >= 500;
}

function isSuccessStatus(statusCode: number): boolean {
  if (statusCode >= 200 && statusCode < 300) return true;
  return statusCode === 409;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toUpperCase();
  return message.includes("TIMEOUT") || message.includes("ETIMEDOUT");
}

function shouldRetryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isTimeoutError(error)) return true;
  const message = error.message.toUpperCase();
  return message.includes("ECONNRESET") || message.includes("ECONNREFUSED") || message.includes("EAI_AGAIN");
}

export function defaultPostJson(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<CallbackAttemptResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const requester = isHttps ? httpsRequest : httpRequest;

    const req = requester(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("CALLBACK_TIMEOUT"));
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export class CallbackClient {
  private readonly options: CallbackClientOptions;

  constructor(options: CallbackClientOptions) {
    this.options = {
      ...options,
      logger: options.logger ?? defaultLogger,
      sleepFn: options.sleepFn ?? defaultSleep,
      postFn: options.postFn ?? defaultPostJson,
    };
  }

  async send(payload: WorkerCallbackPayload, options: CallbackSendOptions = {}): Promise<CallbackAttemptResult> {
    const maxRetries = options.maxRetriesOverride ?? this.options.maxRetries;
    const targetUrl = new URL("/internal/scrape-results", this.options.baseUrl).toString();

    let attempt = 0;
    while (attempt <= maxRetries) {
      const timestamp = Date.now().toString();
      const rawBody = JSON.stringify(payload);
      const signature = buildSignature(this.options.secret, timestamp, rawBody);

      try {
        const result = await this.options.postFn!(targetUrl, rawBody, {
          "Content-Type": "application/json",
          "X-Timestamp": timestamp,
          "X-Signature": signature,
        }, this.options.timeoutMs);

        if (isSuccessStatus(result.statusCode)) {
          return result;
        }

        if (isRetryableStatus(result.statusCode)) {
          throw new Error(`CALLBACK_5XX:${result.statusCode}`);
        }

        throw new Error(`CALLBACK_NON_RETRYABLE:${result.statusCode}`);
      } catch (error) {
        const retryableError = shouldRetryError(error) || (error instanceof Error && error.message.startsWith("CALLBACK_5XX"));
        if (!retryableError || attempt === maxRetries) {
          throw error;
        }

        const backoffMs = 500 * Math.pow(2, attempt);
        this.options.logger!.error("콜백 전송 재시도", {
          job_id: payload.job_id,
          attempt: attempt + 1,
          backoff_ms: backoffMs,
          error: error instanceof Error ? error.message : String(error),
        });
        attempt += 1;
        await this.options.sleepFn!(backoffMs);
      }
    }

    throw new Error("콜백 전송 재시도 한도를 초과했습니다.");
  }
}
