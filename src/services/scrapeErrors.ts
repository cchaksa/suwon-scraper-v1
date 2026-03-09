import type { WorkerErrorCode } from "../types/worker";

export class ScrapeJobError extends Error {
  readonly errorCode: WorkerErrorCode;
  readonly retryable: boolean;

  constructor(errorCode: WorkerErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "ScrapeJobError";
    this.errorCode = errorCode;
    this.retryable = retryable;
  }
}
