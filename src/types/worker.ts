export type WorkerPortalType = "suwon";

export interface ScrapeRequestPayload {
  username: string;
  password: string;
  [key: string]: unknown;
}

export interface WorkerJobInput {
  job_id: string;
  user_id: string;
  portal_type: WorkerPortalType;
  request_payload: ScrapeRequestPayload;
  requested_at: string;
}

export interface WorkerSuccessMetadata {
  bucket: string;
  content_length: number;
  stored_at: string;
  storage_class: string;
  upload_attempt: number;
  requested_at?: string;
  retention_days?: number;
}

export interface WorkerSuccessResult {
  job_id: string;
  status: "succeeded";
  result_s3_key: string;
  result_checksum: string;
  metadata: WorkerSuccessMetadata;
  finished_at: string;
}

export interface WorkerFailureResult {
  job_id: string;
  status: "failed";
  error_code: WorkerErrorCode;
  error_message: string;
  retryable: boolean;
  finished_at: string;
}

export type WorkerCallbackPayload = WorkerSuccessResult | WorkerFailureResult;

export type WorkerErrorCode =
  | "INVALID_PAYLOAD"
  | "PORTAL_TIMEOUT"
  | "PORTAL_TEMPORARY_UNAVAILABLE"
  | "PORTAL_AUTH_FAILED"
  | "PORTAL_ACCOUNT_LOCKED"
  | "BUSINESS_RULE_VIOLATION"
  | "CALLBACK_TIMEOUT"
  | "CALLBACK_5XX"
  | "RESULT_UPLOAD_FAILED"
  | "UNKNOWN_NON_RETRYABLE";

export interface ClassifiedWorkerError {
  error_code: WorkerErrorCode;
  error_message: string;
  retryable: boolean;
}
