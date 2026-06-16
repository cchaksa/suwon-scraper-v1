// POST /login HTTP 라우트 동작을 검증하는 테스트
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server";
import { ScrapeJobError } from "../services/scrapeErrors";

type TestHandler = (req: any, res: any) => Promise<unknown>;

function createMockResponse() {
  return {
    statusCode: 200,
    body: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload?: unknown) {
      this.body = payload === undefined ? "" : String(payload);
      return this;
    },
  };
}

async function callHandler(handler: TestHandler, body: unknown): Promise<{ status: number; body: string }> {
  const response = createMockResponse();
  await handler({ body }, response);
  return {
    status: response.statusCode,
    body: response.body,
  };
}

function getRouteMethods(app: unknown, path: string): string[] {
  const stack = (app as any)._router.stack as any[];
  const layer = stack.find(item => item.route?.path === path);
  return layer ? Object.keys(layer.route.methods) : [];
}

function getRouteHandler(app: unknown, path: string, method: string): TestHandler {
  const stack = (app as any)._router.stack as any[];
  const layer = stack.find(item => item.route?.path === path);
  const routeLayer = layer?.route?.stack.find((item: any) => item.method === method);
  assert.ok(routeLayer, `${method.toUpperCase()} ${path} route handler expected`);
  return routeLayer.handle;
}

test("createApp는 POST /login 라우트를 등록한다", () => {
  const app = createApp({
    loginFn: async () => {},
  });

  assert.ok(getRouteMethods(app, "/login").includes("post"));
});

test("POST /login 성공 시 204를 반환하고 스크래핑을 실행하지 않는다", async () => {
  let loginCalls = 0;
  let scrapeCalls = 0;
  const app = createApp({
    loginFn: async params => {
      loginCalls += 1;
      assert.equal(params.username, "17019013");
      assert.equal(params.password, "pw");
    },
    scrapeFn: async () => {
      scrapeCalls += 1;
      return {} as any;
    },
  });
  const handler = getRouteHandler(app, "/login", "post");

  const response = await callHandler(handler, { username: "17019013", password: "pw" });

  assert.equal(response.status, 204);
  assert.equal(response.body, "");
  assert.equal(loginCalls, 1);
  assert.equal(scrapeCalls, 0);
});

test("POST /login 포털 인증 실패 시 401을 반환한다", async () => {
  const app = createApp({
    loginFn: async () => {
      throw new ScrapeJobError("PORTAL_AUTH_FAILED", "auth failed", false);
    },
  });
  const handler = getRouteHandler(app, "/login", "post");

  const response = await callHandler(handler, { username: "17019013", password: "bad" });

  assert.equal(response.status, 401);
});

test("POST /login 계정 잠금 시 423을 반환한다", async () => {
  const app = createApp({
    loginFn: async () => {
      throw new ScrapeJobError("PORTAL_ACCOUNT_LOCKED", "locked", false);
    },
  });
  const handler = getRouteHandler(app, "/login", "post");

  const response = await callHandler(handler, { username: "17019013", password: "pw" });

  assert.equal(response.status, 423);
});

test("POST /login 시스템성 오류 시 500을 반환한다", async () => {
  const app = createApp({
    loginFn: async () => {
      throw new Error("browser failed");
    },
  });
  const handler = getRouteHandler(app, "/login", "post");

  const response = await callHandler(handler, { username: "17019013", password: "pw" });

  assert.equal(response.status, 500);
});

test("POST /auth는 로그인 helper를 호출하고 기존 JSON 성공 응답을 유지한다", async () => {
  let loginCalls = 0;
  const app = createApp({
    loginFn: async () => {
      loginCalls += 1;
    },
  });
  const handler = getRouteHandler(app, "/auth", "post");

  const response = await callHandler(handler, { username: "17019013", password: "pw" });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { success: true, message: "로그인 성공" });
  assert.equal(loginCalls, 1);
});
