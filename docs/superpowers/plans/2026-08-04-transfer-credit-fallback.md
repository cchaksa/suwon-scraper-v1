# 편입인정학점 보정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수강 데이터가 없는 성적 과목도 `gainPoint`를 최종 `point`로 제공한다.

**Architecture:** 기존 `mergeCreditCourse`의 성적 단독 분기에서 `CreditDTO`를 병합 결과로 복사하고, `gainPoint`가 nullish가 아닐 때만 `point`를 설정한다. 과목 코드 특례 없이 모든 성적 데이터에 같은 규칙을 적용한다.

**Tech Stack:** Node.js, TypeScript, `node:test`

## Global Constraints

- `gainPoint=0`은 유효한 값으로 `point=0`을 만든다.
- `gainPoint`가 `null` 또는 `undefined`면 `point`를 만들지 않는다.
- 기존 수강·성적 병합 동작과 학기 키 및 과목 코드 기준은 유지한다.
- 지정과목 크롤링은 실제 응답 스키마 확보 전까지 구현하지 않는다.
- `dist/*`는 검증 산출물로만 사용하고 커밋하지 않는다.

---

### Task 1: 성적 단독 과목의 학점 보정

**Files:**
- Modify: `src/services/merge.ts`
- Test: `src/tests/merge.spec.ts`
- Modify: `checklist.md`
- Create: `docs/transfer-student-context.md`

**Interfaces:**
- Consumes: `mergeCreditCourse(creditDTOs: CreditDTO[], courseDTOs: CourseDTO[])`
- Produces: 성적 단독 과목에서 `gainPoint != null`이면 `MergedSemesterCourseDTO.point`가 같은 값을 갖는 결과

- [x] **Step 1: 성적 단독 및 nullish 경계 테스트를 추가한다.**

```ts
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
```

- [x] **Step 2: 대상 테스트가 기대한 이유로 실패하는지 확인한다.**

Run: `corepack yarn build && node --test dist/tests/merge.spec.js`

Expected: 성적 단독 `gainPoint` 테스트가 `undefined !== 3`으로 실패한다.

- [x] **Step 3: 성적 단독 분기에 최소 보정 로직을 추가한다.**

```ts
const merged: MergedSemesterCourseDTO = { ...credit };
if (credit.gainPoint != null) {
  merged.point = credit.gainPoint;
}
semesterMap[semesterKey].courses[credit.subjtCd] = merged;
```

- [x] **Step 4: 대상 테스트와 전체 테스트를 실행한다.**

Run: `corepack yarn build && node --test dist/tests/merge.spec.js`

Expected: 병합 테스트 4개가 모두 통과한다.

Run: `corepack yarn test`

Expected: 전체 테스트가 실패 없이 통과한다.

- [x] **Step 5: 생성된 `dist`를 원복하고 변경 범위를 점검한다.**

Run: `git restore dist && git diff --check && git status --short`

Expected: 소스, 테스트, 계획, 체크리스트, 컨텍스트 문서만 변경 상태다.

- [x] **Step 6: 변경을 커밋한다.**

```bash
git add src/services/merge.ts src/tests/merge.spec.ts checklist.md docs/transfer-student-context.md docs/superpowers/plans/2026-08-04-transfer-credit-fallback.md
git commit -m "207 fix: 성적 단독 편입인정학점 보정"
```
