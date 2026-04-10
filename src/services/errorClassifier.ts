import { ScrapeJobError } from "./scrapeErrors";
import { ResultStorageError } from "./resultStorage";
import type { ClassifiedWorkerError } from "../types/worker";

export function classifyWorkerError(error: unknown): ClassifiedWorkerError {
  if (error instanceof ScrapeJobError) {
    return {
      error_code: error.errorCode,
      error_message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof ResultStorageError) {
    return {
      error_code: "RESULT_UPLOAD_FAILED",
      error_message: error.message,
      retryable: true,
    };
  }

  const message = error instanceof Error ? error.message : "unknown error";
  const normalizedMessage = message.toUpperCase();

  if (normalizedMessage.includes("LOGIN_ERROR")) {
    return {
      error_code: "PORTAL_AUTH_FAILED",
      error_message: "아이디나 비밀번호가 일치하지 않습니다.\n학교 홈페이지에서 확인해주세요.",
      retryable: false,
    };
  }

  if (normalizedMessage.includes("ACCOUNT_LOCKED")) {
    return {
      error_code: "PORTAL_ACCOUNT_LOCKED",
      error_message: "계정이 잠겼습니다. 포털사이트로 돌아가서 학번/사번 찾기 및 비밀번호 재발급을 진행해주세요.",
      retryable: false,
    };
  }

  if (normalizedMessage.includes("ABORT") || normalizedMessage.includes("TIMEOUT") || normalizedMessage.includes("ETIMEDOUT")) {
    return {
      error_code: "PORTAL_TIMEOUT",
      error_message: message,
      retryable: true,
    };
  }

  if (
    normalizedMessage.includes("EAI_AGAIN") ||
    normalizedMessage.includes("ECONNRESET") ||
    normalizedMessage.includes("ECONNREFUSED")
  ) {
    return {
      error_code: "PORTAL_TEMPORARY_UNAVAILABLE",
      error_message: message,
      retryable: true,
    };
  }

  return {
    error_code: "UNKNOWN_NON_RETRYABLE",
    error_message: message,
    retryable: false,
  };
}
