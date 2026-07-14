// point가 null일 때 gainPoint를 학점으로 보정하는 병합 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { CourseDTO } from "../dtos/CourseDTO";
import type { CreditDTO } from "../dtos/CreditDTO";
import { mergeCreditCourse } from "../services/merge";

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
