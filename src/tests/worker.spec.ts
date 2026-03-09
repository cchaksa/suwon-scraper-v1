import test from "node:test";
import assert from "node:assert/strict";
import { runWorker, runWorkerFromEnvironment, runWorkerMessage, type WorkerConfig, type WorkerRuntimeDeps } from "../worker";
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
    sqsQueueUrl: "https://sqs.ap-northeast-2.amazonaws.com/123456789012/worker-queue",
    sqsPollWaitTimeSeconds: 10,
    sqsPollVisibilityTimeoutSeconds: 60,
    awsRegion: "ap-northeast-2",
    inputMode: "auto",
  };
}

function createDeps(overrides: Partial<WorkerRuntimeDeps> = {}) {
  const callbackPayloads: WorkerCallbackPayload[] = [];
  let deleted = 0;
  let received = 0;

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
      academicRecords: {
        listSmrCretSumTabYearSmr: [],
        selectSmrCretSumTabSjTotal: { gainPoint: "0", applPoint: "0", gainAvmk: "0", gainTavgPont: "0" },
      },
    }),
    sqsInputClient: {
      receiveOne: async () => {
        received += 1;
        return {
          body: JSON.stringify({
            job_id: "polled-job-1",
            user_id: "user-1",
            portal_type: "suwon",
            request_payload: { username: "17019013", password: "pw" },
            requested_at: "2026-03-03T10:00:00.000Z",
          }),
          messageId: "polled-msg-1",
          receiptHandle: "rh-1",
        };
      },
      deleteMessage: async () => {
        deleted += 1;
      },
    },
    ...overrides,
  };

  return {
    deps,
    callbackPayloads,
    getDeleteCount: () => deleted,
    getReceiveCount: () => received,
  };
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
  assert.equal(exitCode, 1);
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
  assert.equal(exitCode, 1);
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
  assert.equal(exitCode, 1);
  assert.equal(callbackPayloads.length, 1);
  if (callbackPayloads[0].status === "failed") {
    assert.equal(callbackPayloads[0].error_code, "PORTAL_AUTH_FAILED");
    assert.equal(callbackPayloads[0].retryable, false);
  } else {
    assert.fail("failed payload expected");
  }
});

test("env/argv 입력이 없으면 poll 모드로 1건 수신", async () => {
  const config = createConfig();
  config.sqsMessageBody = "";
  const { deps, getReceiveCount } = createDeps();

  const exitCode = await runWorker(config, deps, { argvMessage: "" });
  assert.equal(exitCode, 0);
  assert.equal(getReceiveCount(), 1);
});

test("pipe 모드에서 env 메시지가 없으면 poll하지 않고 실패", async () => {
  const config = createConfig();
  config.inputMode = "pipe";
  config.sqsMessageBody = "";
  const { deps, getReceiveCount } = createDeps();

  await assert.rejects(
    () => runWorker(config, deps, { argvMessage: "" }),
    /INPUT_SOURCE_MISSING: WORKER_INPUT_MODE=pipe 에서는 SQS_MESSAGE_BODY가 필수입니다\./
  );
  assert.equal(getReceiveCount(), 0);
});

test("poll 모드 성공 시 deleteMessage 호출", async () => {
  const config = createConfig();
  config.sqsMessageBody = "";
  const { deps, getDeleteCount } = createDeps();

  const exitCode = await runWorker(config, deps, { argvMessage: "" });
  assert.equal(exitCode, 0);
  assert.equal(getDeleteCount(), 1);
});

test("poll 모드 실패 시 deleteMessage 미호출", async () => {
  const config = createConfig();
  config.sqsMessageBody = "";
  const { deps, getDeleteCount } = createDeps({
    scrapeFn: async () => {
      throw new ScrapeJobError("PORTAL_TIMEOUT", "timeout", true);
    },
  });

  const exitCode = await runWorker(config, deps, { argvMessage: "" });
  assert.equal(exitCode, 1);
  assert.equal(getDeleteCount(), 0);
});

test("기존 env 경로가 우선이며 poll 호출하지 않음", async () => {
  const config = createConfig();
  config.sqsMessageBody = JSON.stringify({
    job_id: "env-job-1",
    user_id: "user-10",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });
  const { deps, getReceiveCount } = createDeps();

  const exitCode = await runWorker(config, deps, { argvMessage: "" });
  assert.equal(exitCode, 0);
  assert.equal(getReceiveCount(), 0);
});

test("pipe 모드 env는 실제 SQS body JSON string을 그대로 파싱한다", async () => {
  const config = createConfig();
  config.inputMode = "pipe";
  config.sqsMessageBody = "{\"job_id\":\"pipe-json-job-1\",\"user_id\":\"user-13\",\"portal_type\":\"suwon\",\"request_payload\":{\"username\":\"17019013\",\"password\":\"pw\"},\"requested_at\":\"2026-03-03T10:00:00.000Z\"}";
  const { deps, getReceiveCount, callbackPayloads } = createDeps();

  const exitCode = await runWorker(config, deps, { argvMessage: "" });
  assert.equal(exitCode, 0);
  assert.equal(getReceiveCount(), 0);
  assert.equal(callbackPayloads.length, 1);
  assert.equal(callbackPayloads[0].status, "succeeded");
});

test("pipe 모드에서도 env 메시지가 있으면 정상 처리", async () => {
  const config = createConfig();
  config.inputMode = "pipe";
  config.sqsMessageBody = JSON.stringify({
    job_id: "pipe-env-job-1",
    user_id: "user-12",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });
  const { deps, getReceiveCount } = createDeps();

  const exitCode = await runWorker(config, deps, { argvMessage: "" });
  assert.equal(exitCode, 0);
  assert.equal(getReceiveCount(), 0);
});

test("literal 문자열 $[0].body 는 INVALID_PAYLOAD로 실패한다", async () => {
  const config = createConfig();
  config.inputMode = "pipe";
  const { deps, callbackPayloads } = createDeps();

  const exitCode = await runWorkerMessage("$[0].body", config, deps);
  assert.equal(exitCode, 1);
  assert.equal(callbackPayloads.length, 0);
});

test("기존 argv 경로가 poll보다 우선", async () => {
  const config = createConfig();
  config.sqsMessageBody = "";
  const { deps, getReceiveCount } = createDeps();
  const argRaw = JSON.stringify({
    job_id: "argv-job-1",
    user_id: "user-11",
    portal_type: "suwon",
    request_payload: { username: "17019013", password: "pw" },
    requested_at: "2026-03-03T10:00:00.000Z",
  });

  const exitCode = await runWorker(config, deps, { argvMessage: argRaw });
  assert.equal(exitCode, 0);
  assert.equal(getReceiveCount(), 0);
});

test("env/argv/queue 모두 없으면 INPUT_SOURCE_MISSING 종료", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevCallbackUrl = process.env.SCRAPE_CALLBACK_BASE_URL;
  const prevCallbackSecret = process.env.SCRAPE_CALLBACK_HMAC_SECRET;
  const prevSqsBody = process.env.SQS_MESSAGE_BODY;
  const prevSqsQueueUrl = process.env.SQS_QUEUE_URL;

  try {
    process.env.NODE_ENV = "production";
    process.env.SCRAPE_CALLBACK_BASE_URL = "https://callback.example.com";
    process.env.SCRAPE_CALLBACK_HMAC_SECRET = "secret";
    delete process.env.SQS_MESSAGE_BODY;
    delete process.env.SQS_QUEUE_URL;

    const exitCode = await runWorkerFromEnvironment("");
    assert.equal(exitCode, 1);
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;

    if (prevCallbackUrl === undefined) delete process.env.SCRAPE_CALLBACK_BASE_URL;
    else process.env.SCRAPE_CALLBACK_BASE_URL = prevCallbackUrl;

    if (prevCallbackSecret === undefined) delete process.env.SCRAPE_CALLBACK_HMAC_SECRET;
    else process.env.SCRAPE_CALLBACK_HMAC_SECRET = prevCallbackSecret;

    if (prevSqsBody === undefined) delete process.env.SQS_MESSAGE_BODY;
    else process.env.SQS_MESSAGE_BODY = prevSqsBody;

    if (prevSqsQueueUrl === undefined) delete process.env.SQS_QUEUE_URL;
    else process.env.SQS_QUEUE_URL = prevSqsQueueUrl;
  }
});

test("pipe 모드 환경 실행에서 env 메시지 누락 시 INPUT_SOURCE_MISSING 종료", async () => {
  const prevCallbackUrl = process.env.SCRAPE_CALLBACK_BASE_URL;
  const prevCallbackSecret = process.env.SCRAPE_CALLBACK_HMAC_SECRET;
  const prevInputMode = process.env.WORKER_INPUT_MODE;
  const prevSqsBody = process.env.SQS_MESSAGE_BODY;
  const prevSqsQueueUrl = process.env.SQS_QUEUE_URL;

  try {
    process.env.SCRAPE_CALLBACK_BASE_URL = "https://callback.example.com";
    process.env.SCRAPE_CALLBACK_HMAC_SECRET = "secret";
    process.env.WORKER_INPUT_MODE = "pipe";
    delete process.env.SQS_MESSAGE_BODY;
    process.env.SQS_QUEUE_URL = "https://sqs.ap-northeast-2.amazonaws.com/123456789012/worker-queue";

    const exitCode = await runWorkerFromEnvironment("");
    assert.equal(exitCode, 1);
  } finally {
    if (prevCallbackUrl === undefined) delete process.env.SCRAPE_CALLBACK_BASE_URL;
    else process.env.SCRAPE_CALLBACK_BASE_URL = prevCallbackUrl;

    if (prevCallbackSecret === undefined) delete process.env.SCRAPE_CALLBACK_HMAC_SECRET;
    else process.env.SCRAPE_CALLBACK_HMAC_SECRET = prevCallbackSecret;

    if (prevInputMode === undefined) delete process.env.WORKER_INPUT_MODE;
    else process.env.WORKER_INPUT_MODE = prevInputMode;

    if (prevSqsBody === undefined) delete process.env.SQS_MESSAGE_BODY;
    else process.env.SQS_MESSAGE_BODY = prevSqsBody;

    if (prevSqsQueueUrl === undefined) delete process.env.SQS_QUEUE_URL;
    else process.env.SQS_QUEUE_URL = prevSqsQueueUrl;
  }
});
