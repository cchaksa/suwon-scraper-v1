// 편입생 지정과목 API 요청과 응답 정규화를 검증하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import { scrapeDesignatedCourses } from "../crawlers/designatedCourseCrawler";
import { ScrapeJobError } from "../services/scrapeErrors";

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

function createPage(data: unknown, options: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; requestOptions: any }> = [];
  const page = {
    request: {
      post: async (url: string, requestOptions: any) => {
        calls.push({ url, requestOptions });
        return {
          ok: () => options.ok ?? true,
          status: () => options.status ?? 200,
          json: async () => data,
        };
      },
    },
  } as unknown as Page;

  return { page, calls };
}

test("지정과목 API에 학번을 전달하고 응답 배열을 반환한다", async () => {
  const { page, calls } = createPage({ listPrecpSbjt: [designatedCourse] });

  const result = await scrapeDesignatedCourses(page, "24020044");

  assert.deepEqual(result, [designatedCourse]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://info.suwon.ac.kr/precpSbjt/listPrecpSbjt.do");
  assert.deepEqual(calls[0].requestOptions.data, { sno: "24020044" });
  assert.equal(calls[0].requestOptions.headers["Content-Type"], "application/json;charset=UTF-8");
});

test("빈 배열, null, 응답 키 누락을 빈 배열로 정규화한다", async () => {
  for (const data of [{ listPrecpSbjt: [] }, { listPrecpSbjt: null }, {}]) {
    const { page } = createPage(data);
    assert.deepEqual(await scrapeDesignatedCourses(page, "24020044"), []);
  }
});

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
