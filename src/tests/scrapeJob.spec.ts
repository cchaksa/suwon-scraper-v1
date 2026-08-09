// 인증된 학사 페이지에서 편입생 지정과목을 조건부로 조합하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import type { StudentDTO } from "../dtos/StudentDTO";
import { scrapeAuthenticatedData, type ScrapeDataDeps } from "../services/scrapeJob";

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

function createDeps(enscDvcd: string) {
  let designatedCalls = 0;
  const deps: ScrapeDataDeps = {
    scrapeStudent: async () => ({ sno: "24020044", enscDvcd } as StudentDTO),
    scrapeCourses: async () => [],
    scrapeCredits: async () => ({ creditDTOs: [], gradeResponse }),
    scrapeDesignatedCourses: async () => {
      designatedCalls += 1;
      return [designatedCourse];
    },
  };

  return { deps, getDesignatedCalls: () => designatedCalls };
}

test("편입생이면 지정과목을 한 번 조회해 결과에 포함한다", async () => {
  const { deps, getDesignatedCalls } = createDeps("2");

  const result = await scrapeAuthenticatedData({} as Page, "24020044", deps);

  assert.equal(getDesignatedCalls(), 1);
  assert.deepEqual(result.designatedCourses, [designatedCourse]);
  assert.equal(result.student.enscDvcd, "2");
});

test("비편입생이면 지정과목 API를 호출하지 않고 빈 배열을 반환한다", async () => {
  const { deps, getDesignatedCalls } = createDeps("1");

  const result = await scrapeAuthenticatedData({} as Page, "24020044", deps);

  assert.equal(getDesignatedCalls(), 0);
  assert.deepEqual(result.designatedCourses, []);
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

  resolveStudent({ sno: "24020044", enscDvcd: "2" } as StudentDTO);
  await resultPromise;

  assert.deepEqual(calls, ["student", "courses", "credits", "designatedCourses"]);
});
