// 편입생 지정과목 API 요청과 응답 형식 검증을 확인하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import { scrapeDesignatedCourses } from "../crawlers/designatedCourseCrawler";
import { ScrapeJobError } from "../services/scrapeErrors";
import { classifyWorkerError } from "../services/errorClassifier";

const designatedCourse: DesignatedCourseDTO = {
  orgClsCd: "ORG",
  subjtCd: "SUBJ001",
  subjtNm: "지정과목",
  point: 3,
  precpResnCd: "01",
  cretGainYear: "2026",
  cretSmrNm: "1학기",
  sno: "24020044",
};

function createPage(data: unknown, options: { ok?: boolean; status?: number; jsonError?: Error } = {}) {
  const calls: Array<{ url: string; requestOptions: any }> = [];
  const page = {
    request: {
      post: async (url: string, requestOptions: any) => {
        calls.push({ url, requestOptions });
        return {
          ok: () => options.ok ?? true,
          status: () => options.status ?? 200,
          json: async () => {
            if (options.jsonError) throw options.jsonError;
            return data;
          },
        };
      },
    },
  } as unknown as Page;

  return { page, calls };
}

test("지정과목 API에 학번과 조직분류코드 20을 전달하고 precpSbjtList의 원본 필드를 보존한다", async () => {
  const courses = [
    { ...designatedCourse, extraPortalField: "원본 추가 필드" },
    { ...designatedCourse, subjtCd: "SUBJ002", subjtNm: "두 번째 지정과목" },
    { ...designatedCourse, subjtCd: "SUBJ003", subjtNm: "세 번째 지정과목" },
  ];
  const { page, calls } = createPage({ precpSbjtList: courses });

  const result = await scrapeDesignatedCourses(page, "24020044");

  assert.deepEqual(result, courses);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://info.suwon.ac.kr/precpSbjt/listPrecpSbjt.do");
  assert.deepEqual(calls[0].requestOptions.data, { sno: "24020044", orgClsCd: "20" });
  assert.equal(calls[0].requestOptions.headers["Content-Type"], "application/json;charset=UTF-8");
});

test("학부 코드로 조회한 명시적인 precpSbjtList 빈 배열은 정상 결과다", async () => {
  const { page, calls } = createPage({ precpSbjtList: [] });
  assert.deepEqual(await scrapeDesignatedCourses(page, "24020044"), []);
  assert.deepEqual(calls[0].requestOptions.data, { sno: "24020044", orgClsCd: "20" });
});

const invalidResponses = [
  { name: "응답 키 누락", data: {} },
  { name: "잘못된 키만 존재", data: { listPrecpSbjt: [designatedCourse] } },
  { name: "목록 null", data: { precpSbjtList: null } },
  { name: "목록 객체", data: { precpSbjtList: {} } },
  { name: "목록 문자열", data: { precpSbjtList: "[]" } },
  { name: "목록 숫자", data: { precpSbjtList: 0 } },
  { name: "목록 boolean", data: { precpSbjtList: false } },
  { name: "최상위 null", data: null },
  { name: "최상위 배열", data: [] },
  { name: "최상위 문자열", data: "응답 원문" },
];

for (const { name, data } of invalidResponses) {
  test(`${name}은 재시도 불가능한 지정과목 응답 형식 오류다`, async () => {
    const { page } = createPage(data);
    await assert.rejects(() => scrapeDesignatedCourses(page, "24020044"), error => {
      assert.ok(error instanceof ScrapeJobError);
      assert.equal(error.errorCode, "PORTAL_RESPONSE_SCHEMA_MISMATCH");
      assert.equal(error.retryable, false);
      assert.equal(error.message, "지정과목 응답의 precpSbjtList가 배열이 아닙니다.");
      return true;
    });
  });
}

test("JSON 구문 오류는 응답 원문 없이 형식 오류로 전달한다", async () => {
  const { page } = createPage(undefined, { jsonError: new SyntaxError("Unexpected token: 비공개 응답 원문") });
  await assert.rejects(() => scrapeDesignatedCourses(page, "24020044"), error => {
    assert.ok(error instanceof ScrapeJobError);
    assert.equal(error.errorCode, "PORTAL_RESPONSE_SCHEMA_MISMATCH");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "지정과목 응답을 JSON으로 해석할 수 없습니다.");
    return true;
  });
});

for (const [message, errorCode] of [
  ["request timeout", "PORTAL_TIMEOUT"],
  ["ECONNRESET", "PORTAL_TEMPORARY_UNAVAILABLE"],
]) {
  test(`응답 본문을 읽는 중 ${message} 오류는 기존 재시도 정책을 유지한다`, async () => {
    const readError = new Error(message);
    const { page } = createPage(undefined, { jsonError: readError });
    await assert.rejects(() => scrapeDesignatedCourses(page, "24020044"), error => {
      assert.equal(error, readError);
      assert.equal(classifyWorkerError(error).error_code, errorCode);
      assert.equal(classifyWorkerError(error).retryable, true);
      return true;
    });
  });
}

test("지정과목 API 5xx 응답은 재시도 가능한 일시 오류를 던진다", async () => {
  const { page } = createPage({}, { ok: false, status: 503 });

  await assert.rejects(() => scrapeDesignatedCourses(page, "24020044"), error => {
    assert.ok(error instanceof ScrapeJobError);
    assert.equal(error.errorCode, "PORTAL_TEMPORARY_UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.match(error.message, /Failed to fetch designated courses: 503/);
    return true;
  });
});

test("지정과목 API 4xx 응답은 기존 상태 코드 오류를 유지한다", async () => {
  const { page } = createPage({}, { ok: false, status: 400 });

  await assert.rejects(() => scrapeDesignatedCourses(page, "24020044"), error => {
    assert.ok(!(error instanceof ScrapeJobError));
    assert.match(error instanceof Error ? error.message : String(error), /Failed to fetch designated courses: 400/);
    return true;
  });
});
