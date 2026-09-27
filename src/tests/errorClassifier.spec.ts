import test from "node:test";
import assert from "node:assert/strict";
import { classifyWorkerError } from "../services/errorClassifier";
import { ScrapeJobError } from "../services/scrapeErrors";
import { ResultStorageError } from "../services/resultStorage";

test("ScrapeJobError는 지정 코드와 retryable 유지", () => {
  const error = new ScrapeJobError("PORTAL_AUTH_FAILED", "인증 실패", false);
  const classified = classifyWorkerError(error);
  assert.equal(classified.error_code, "PORTAL_AUTH_FAILED");
  assert.equal(classified.retryable, false);
});

test("timeout 메시지는 retryable timeout으로 분류", () => {
  const classified = classifyWorkerError(new Error("request timeout exceeded"));
  assert.equal(classified.error_code, "PORTAL_TIMEOUT");
  assert.equal(classified.retryable, true);
});

test("포털 응답 형식 오류는 코드와 재시도 불가 상태를 유지한다", () => {
  const error = new ScrapeJobError("PORTAL_RESPONSE_SCHEMA_MISMATCH", "지정과목 응답 형식 오류", false);
  assert.deepEqual(classifyWorkerError(error), {
    error_code: "PORTAL_RESPONSE_SCHEMA_MISMATCH",
    error_message: "지정과목 응답 형식 오류",
    retryable: false,
  });
});

test("알 수 없는 오류는 non-retryable로 분류", () => {
  const classified = classifyWorkerError(new Error("something unexpected"));
  assert.equal(classified.error_code, "UNKNOWN_NON_RETRYABLE");
  assert.equal(classified.retryable, false);
});

test("ResultStorageError는 RESULT_UPLOAD_FAILED로 분류", () => {
  const classified = classifyWorkerError(new ResultStorageError("failed to upload"));
  assert.equal(classified.error_code, "RESULT_UPLOAD_FAILED");
  assert.equal(classified.retryable, true);
});
