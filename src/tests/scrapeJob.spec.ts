// 인증된 학사 페이지에서 편입생 지정과목을 조건부로 조합하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import type { StudentDTO } from "../dtos/StudentDTO";
import { scrapeAuthenticatedData, type ScrapeDataDeps } from "../services/scrapeJob";
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

const gradeResponse = {
  listSmrCretSumTabYearSmr: [],
  selectSmrCretSumTabSjTotal: {
    gainPoint: "0",
    applPoint: "0",
    gainAvmk: "0",
    gainTavgPont: "0",
  },
};

function createDeps(enscDvcd: string, orgClsCd?: string) {
  let designatedCalls = 0;
  const designatedRequests: Array<{ username: string; orgClsCd: string | undefined }> = [];
  const deps: ScrapeDataDeps = {
    scrapeStudent: async () => ({ sno: "24020044", enscDvcd, orgClsCd, flangPassGb: "미통과" } as StudentDTO),
    scrapeCourses: async () => [],
    scrapeCredits: async () => ({ creditDTOs: [], gradeResponse }),
    scrapeDesignatedCourses: async (_page, username, orgClsCd) => {
      designatedCalls += 1;
      designatedRequests.push({ username, orgClsCd });
      return [designatedCourse];
    },
  };

  return { deps, getDesignatedCalls: () => designatedCalls, designatedRequests };
}

test("편입생별 학생 정보의 조직분류코드를 지정과목 조회에 전달하고 결과에 보존한다", async () => {
  for (const orgClsCd of ["20", "TEST_OTHER_ORG"]) {
    const { deps, getDesignatedCalls, designatedRequests } = createDeps("2", orgClsCd);

    const result = await scrapeAuthenticatedData({} as Page, "24020044", deps);

    assert.equal(getDesignatedCalls(), 1);
    assert.deepEqual(designatedRequests, [{ username: "24020044", orgClsCd }]);
    assert.deepEqual(result.designatedCourses, [designatedCourse]);
    assert.equal(result.student.orgClsCd, orgClsCd);
    assert.equal(result.student.enscDvcd, "2");
    assert.equal(result.student.flangPassGb, "미통과");
  }
});

test("비편입생은 조직분류코드가 없어도 지정과목 API를 호출하지 않고 빈 배열을 반환한다", async () => {
  const { deps, getDesignatedCalls } = createDeps("1");

  const result = await scrapeAuthenticatedData({} as Page, "24020044", deps);

  assert.equal(getDesignatedCalls(), 0);
  assert.deepEqual(result.designatedCourses, []);
});

test("지정과목 형식 오류는 다른 수집 결과로 대체하지 않고 전체 작업 실패로 전파한다", async () => {
  const { deps } = createDeps("2", "TEST_OTHER_ORG");
  const schemaError = new ScrapeJobError("PORTAL_RESPONSE_SCHEMA_MISMATCH", "지정과목 응답 형식 오류", false);
  deps.scrapeDesignatedCourses = async () => {
    throw schemaError;
  };

  await assert.rejects(() => scrapeAuthenticatedData({} as Page, "24020044", deps), error => {
    assert.equal(error, schemaError);
    return true;
  });
});

test("수강과 성적 요청은 학생 정보 완료를 기다리지 않고 시작한다", async () => {
  const calls: string[] = [];
  let resolveStudent: (student: StudentDTO) => void = () => {};
  const pendingStudent = new Promise<StudentDTO>(resolve => {
    resolveStudent = resolve;
  });
  const deps: ScrapeDataDeps = {
    scrapeStudent: async () => {
      calls.push("student");
      return pendingStudent;
    },
    scrapeCourses: async () => {
      calls.push("courses");
      return [];
    },
    scrapeCredits: async () => {
      calls.push("credits");
      return { creditDTOs: [], gradeResponse };
    },
    scrapeDesignatedCourses: async () => {
      calls.push("designatedCourses");
      return [];
    },
  };

  const resultPromise = scrapeAuthenticatedData({} as Page, "24020044", deps);
  await Promise.resolve();
  assert.deepEqual(calls, ["student", "courses", "credits"]);

  resolveStudent({ sno: "24020044", enscDvcd: "2", orgClsCd: "TEST_OTHER_ORG" } as StudentDTO);
  await resultPromise;

  assert.deepEqual(calls, ["student", "courses", "credits", "designatedCourses"]);
});
