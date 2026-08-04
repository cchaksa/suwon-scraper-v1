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

test("성적 단독 데이터가 중복되면 최신 gainPoint를 point로 사용한다", () => {
  const credits = [createCredit({ gainPoint: 2 }), createCredit({ gainPoint: 3 })];

  const [semester] = mergeCreditCourse(credits, []);

  assert.equal(semester.courses[0].gainPoint, 3);
  assert.equal(semester.courses[0].point, 3);
});

test("성적 데이터의 gainPoint가 명시적 null이면 point를 생성하지 않는다", () => {
  const credit = { ...createCredit(), gainPoint: null } as unknown as CreditDTO;

  const [semester] = mergeCreditCourse([credit], []);

  assert.equal(Object.prototype.hasOwnProperty.call(semester.courses[0], "point"), false);
});

test("수강 데이터의 non-null point는 중복 성적보다 우선한다", () => {
  const course = {
    subjtCd: "04048",
    subjtEstbYear: 2025,
    subjtEstbSmrCd: "10",
    point: 4,
  } as unknown as CourseDTO;
  const credits = [createCredit({ gainPoint: 2 }), createCredit({ gainPoint: 3 })];

  const [semester] = mergeCreditCourse(credits, [course]);

  assert.equal(semester.courses[0].point, 4);
});

test("수강 데이터의 point가 null이면 최신 gainPoint를 point로 사용한다", () => {
  const course = {
    subjtCd: "04048",
    subjtEstbYear: 2025,
    subjtEstbSmrCd: "10",
    point: null,
  } as unknown as CourseDTO;
  const credits = [createCredit({ gainPoint: 2 }), createCredit({ gainPoint: 3 })];

  const [semester] = mergeCreditCourse(credits, [course]);

  assert.equal(semester.courses[0].point, 3);
});

test("성적 단독 데이터의 최신 gainPoint가 null이면 이전 point를 제거한다", () => {
  const credits = [createCredit({ gainPoint: 2 }), { ...createCredit(), gainPoint: null } as unknown as CreditDTO];

  const [semester] = mergeCreditCourse(credits, []);

  assert.equal(Object.prototype.hasOwnProperty.call(semester.courses[0], "point"), false);
});

test("성적 단독 데이터의 최신 gainPoint가 undefined이면 이전 point를 제거한다", () => {
  const credits = [createCredit({ gainPoint: 2 }), createCredit({ gainPoint: undefined })];

  const [semester] = mergeCreditCourse(credits, []);

  assert.equal(Object.prototype.hasOwnProperty.call(semester.courses[0], "point"), false);
});

test("수강 데이터의 원래 point가 null이고 최신 gainPoint가 null이면 null을 보존한다", () => {
  const course = {
    subjtCd: "04048",
    subjtEstbYear: 2025,
    subjtEstbSmrCd: "10",
    point: null,
  } as unknown as CourseDTO;
  const credits = [createCredit({ gainPoint: 2 }), { ...createCredit(), gainPoint: null } as unknown as CreditDTO];

  const [semester] = mergeCreditCourse(credits, [course]);

  assert.equal(semester.courses[0].point, null);
});
