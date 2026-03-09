import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalString, buildSignature, CallbackClient } from "../services/callbackClient";
import type { WorkerFailureResult } from "../types/worker";

const samplePayload: WorkerFailureResult = {
  job_id: "job-1",
  status: "failed",
  error_code: "INVALID_PAYLOAD",
  error_message: "invalid",
  retryable: false,
  finished_at: "2026-03-03T10:00:00.000Z",
};

test("canonical string 생성 규칙", () => {
  const canonical = buildCanonicalString("1700000000000", "{\"a\":1}");
  assert.equal(canonical, "1700000000000.{\"a\":1}");
});

test("HMAC signature 생성", () => {
  const signature = buildSignature("secret-key", "1700000000000", "{\"a\":1}");
  assert.equal(signature, "5f38447ac8fbfc455143cc9d092a36bac576212e95988638a219c2a96ab2e709");
});

test("2xx 응답은 성공으로 처리", async () => {
  const client = new CallbackClient({
    baseUrl: "https://example.com",
    secret: "secret",
    timeoutMs: 1000,
    maxRetries: 3,
    postFn: async () => ({ statusCode: 200, body: "ok" }),
  });

  const result = await client.send(samplePayload);
  assert.equal(result.statusCode, 200);
});

test("409 응답은 중복 성공으로 처리", async () => {
  const client = new CallbackClient({
    baseUrl: "https://example.com",
    secret: "secret",
    timeoutMs: 1000,
    maxRetries: 3,
    postFn: async () => ({ statusCode: 409, body: "{\"already_processed\":true}" }),
  });

  const result = await client.send(samplePayload);
  assert.equal(result.statusCode, 409);
});

test("5xx는 지수 백오프로 재시도", async () => {
  let attempts = 0;
  const slept: number[] = [];

  const client = new CallbackClient({
    baseUrl: "https://example.com",
    secret: "secret",
    timeoutMs: 1000,
    maxRetries: 3,
    postFn: async () => {
      attempts += 1;
      if (attempts < 4) {
        return { statusCode: 500, body: "error" };
      }
      return { statusCode: 200, body: "ok" };
    },
    sleepFn: async ms => {
      slept.push(ms);
    },
  });

  const result = await client.send(samplePayload);
  assert.equal(result.statusCode, 200);
  assert.equal(attempts, 4);
  assert.deepEqual(slept, [500, 1000, 2000]);
});
