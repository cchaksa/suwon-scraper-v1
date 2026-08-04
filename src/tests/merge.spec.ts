// point가 null일 때 gainPoint를 학점으로 보정하는 병합 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { CourseDTO } from "../dtos/CourseDTO";
import type { CreditDTO } from "../dtos/CreditDTO";
import { mergeCreditCourse } from "../services/merge";

function createCredit(overrides: Partial<CreditDTO> = {}): CreditDTO {
  return {
    subjtCd: "04048",
    cretGainYear: "2025",
    cretSmrCd: "10",
    ...overrides,
  } as CreditDTO;
}

test("point가 null이면 gainPoint를 학점으로 사용한다", () => {
  const course = {
    subjtCd: "04048",
    subjtEstbYear: 2025,
    subjtEstbSmrCd: "10",
    point: null,
  } as unknown as CourseDTO;
  const credit = {
    subjtCd: "04048",
    cretGainYear: "2025",
    cretSmrCd: "10",
    gainPoint: 3,
  } as CreditDTO;

  const [semester] = mergeCreditCourse([credit], [course]);

  assert.equal(semester.courses[0].point, 3);
});

test("수강 데이터 없이 성적 데이터만 있으면 gainPoint를 point로 사용한다", () => {
  const credit = createCredit({ gainPoint: 3 });

  const [semester] = mergeCreditCourse([credit], []);

  assert.equal(semester.courses[0].point, 3);
});

test("성적 데이터의 gainPoint가 0이면 point에 0을 유지한다", () => {
  const credit = createCredit({ gainPoint: 0 });

  const [semester] = mergeCreditCourse([credit], []);

  assert.equal(semester.courses[0].point, 0);
});

test("성적 데이터의 gainPoint가 없으면 point를 생성하지 않는다", () => {
  const credit = createCredit({ gainPoint: undefined });

  const [semester] = mergeCreditCourse([credit], []);

  assert.equal(Object.prototype.hasOwnProperty.call(semester.courses[0], "point"), false);
});
