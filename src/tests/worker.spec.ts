import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerMessage, type WorkerConfig, type WorkerRuntimeDeps } from "../worker";
import { ScrapeJobError } from "../services/scrapeErrors";
import type { WorkerCallbackPayload } from "../types/worker";

function createConfig(): WorkerConfig {
  return {
    portalTimeoutMs: 1000,
    totalTimeoutMs: 5000,
    gracefulShutdownMs: 1000,
    callbackTimeoutMs: 1000,
    callbackMaxRetries: 3,
    callbackBaseUrl: "https://callback.example.com",
    callbackSecret: "secret",
    sqsMessageBody: "",
    sqsMessageId: "msg-1",
  };
}

function createDeps(overrides: Partial<WorkerRuntimeDeps> = {}) {
  const callbackPayloads: WorkerCallbackPayload[] = [];
  const deps: WorkerRuntimeDeps = {
    now: () => new Date("2026-03-03T12:00:00.000Z"),
    callbackClient: {
      send: async (payload: WorkerCallbackPayload) => {
        callbackPayloads.push(payload);
        return { statusCode: 200, body: "ok" };
      },
    } as any,
    scrapeFn: async () => ({
      student: { sno: "17019013" } as any,
      semesters: [],
      academicRecords: { listSmrCretSumTabYearSmr: [], selectSmrCretSumTabSjTotal: { gainPoint: "0", applPoint: "0", gainAvmk: "0", gainTavgPont: "0" } },
    }),
    ...overrides,
  };

  return { deps, callbackPayloads };
}

test("정상 처리 시 succeeded 콜백 1회", async () => {
  const config = createConfig();
  const { deps, callbackPayloads } = createDeps();
  const raw = JSON.stringify({
    job_id: "job-1",
    user_id: "user-1",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });

  const exitCode = await runWorkerMessage(raw, config, deps);

  assert.equal(exitCode, 0);
  assert.equal(callbackPayloads.length, 1);
  assert.equal(callbackPayloads[0].status, "succeeded");
});

test("입력 스키마 오류(job_id 존재) 시 failed 콜백 전송", async () => {
  const config = createConfig();
  const { deps, callbackPayloads } = createDeps();
  const raw = JSON.stringify({
    job_id: "job-2",
    user_id: "user-2",
    portal_type: "suwon",
    request_payload: { username: "17019013" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });

  const exitCode = await runWorkerMessage(raw, config, deps);

  assert.equal(exitCode, 0);
  assert.equal(callbackPayloads.length, 1);
  assert.equal(callbackPayloads[0].status, "failed");
  if (callbackPayloads[0].status === "failed") {
    assert.equal(callbackPayloads[0].error_code, "INVALID_PAYLOAD");
    assert.equal(callbackPayloads[0].retryable, false);
  }
});

test("job_id 누락 INVALID_PAYLOAD는 콜백 없이 exit 1", async () => {
  const config = createConfig();
  const { deps, callbackPayloads } = createDeps();
  const raw = JSON.stringify({
    user_id: "user-3",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });

  const exitCode = await runWorkerMessage(raw, config, deps);

  assert.equal(exitCode, 1);
  assert.equal(callbackPayloads.length, 0);
});

test("포털 일시 실패는 retryable=true 콜백", async () => {
  const config = createConfig();
  const { deps, callbackPayloads } = createDeps({
    scrapeFn: async () => {
      throw new ScrapeJobError("PORTAL_TIMEOUT", "timeout", true);
    },
  });
  const raw = JSON.stringify({
    job_id: "job-4",
    user_id: "user-4",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });

  const exitCode = await runWorkerMessage(raw, config, deps);
  assert.equal(exitCode, 0);
  assert.equal(callbackPayloads.length, 1);
  if (callbackPayloads[0].status === "failed") {
    assert.equal(callbackPayloads[0].error_code, "PORTAL_TIMEOUT");
    assert.equal(callbackPayloads[0].retryable, true);
  } else {
    assert.fail("failed payload expected");
  }
});

test("포털 영구 실패는 retryable=false 콜백", async () => {
  const config = createConfig();
  const { deps, callbackPayloads } = createDeps({
    scrapeFn: async () => {
      throw new ScrapeJobError("PORTAL_AUTH_FAILED", "auth failed", false);
    },
  });
  const raw = JSON.stringify({
    job_id: "job-5",
    user_id: "user-5",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });

  const exitCode = await runWorkerMessage(raw, config, deps);
  assert.equal(exitCode, 0);
  assert.equal(callbackPayloads.length, 1);
  if (callbackPayloads[0].status === "failed") {
    assert.equal(callbackPayloads[0].error_code, "PORTAL_AUTH_FAILED");
    assert.equal(callbackPayloads[0].retryable, false);
  } else {
    assert.fail("failed payload expected");
  }
});
