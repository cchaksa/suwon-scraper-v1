// 학생 정보 API 응답의 핵심 계약 필드 매핑을 검증하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { scrapeStudent } from "../crawlers/studentCrawler";

function createPage(studentInfo: Record<string, unknown>) {
  const page = {
    request: {
      post: async () => ({
        ok: () => true,
        status: () => 200,
        json: async () => ({ studentInfo }),
      }),
    },
  } as unknown as Page;

  return page;
}

function createStudentInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sno: "24020044",
    studNm: "테스트 학생",
    univCd: "2000510",
    univNm: "ICT융합대학",
    dpmjCd: "2000513",
    dpmjNm: "정보통신학부",
    mjorCd: "2000516",
    mjorNm: "정보통신",
    enscYear: "2024",
    enscSmrCd: "10",
    scrgStatNm: "재학",
    studGrde: 3,
    enscDvcd: "2",
    facSmrCnt: "4",
    flangPassGb: "미통과",
    ...overrides,
  };
}

test("입학 구분과 외국어 인증 상태를 원본 그대로 매핑한다", async () => {
  const result = await scrapeStudent(createPage(createStudentInfo()), "24020044");

  assert.equal(result.enscDvcd, "2");
  assert.equal(result.flangPassGb, "미통과");
});

test("외국어 인증 상태가 누락되면 undefined를 유지한다", async () => {
  const studentInfo = createStudentInfo();
  delete studentInfo.flangPassGb;

  const result = await scrapeStudent(createPage(studentInfo), "24020044");

  assert.equal(result.flangPassGb, undefined);
});

test("학생 정보의 조직분류코드는 orgCd와 구분해 원본 그대로 매핑한다", async () => {
  for (const orgClsCd of ["20", "TEST_OTHER_ORG"]) {
    const result = await scrapeStudent(createPage(createStudentInfo({ orgClsCd, orgCd: "TEST_DEPARTMENT" })), "24020044");
    assert.equal(result.orgClsCd, orgClsCd);
  }
});

test("유효한 문자열 조직분류코드가 없으면 orgCd나 20으로 대체하지 않는다", async () => {
  for (const orgClsCd of [undefined, null, 20, {}, []]) {
    const result = await scrapeStudent(createPage(createStudentInfo({ orgClsCd, orgCd: "TEST_DEPARTMENT" })), "24020044");
    assert.equal(result.orgClsCd, undefined);
  }
});
