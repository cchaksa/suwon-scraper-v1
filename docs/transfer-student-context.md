# 편입생 처리 컨텍스트

## 작업 이름

편입인정학점 병합 보정.

## 작업 배경과 문제 정의

편입인정학점은 수강 데이터의 `point`가 비어 있고 성적 데이터의 `gainPoint`에 실제 학점이 들어올 수 있다. 현재 병합 로직은 수강 데이터와 성적 데이터가 모두 있을 때만 `gainPoint`를 `point`로 보정하며, 성적 데이터만 존재하는 경우에는 `point`가 생성되지 않는다.

## 목표와 비목표

- 목표는 성적 데이터만 존재해도 nullish가 아닌 `gainPoint`를 `point`로 제공하는 것이다.
- `gainPoint=0`은 유효한 학점으로 유지한다.
- 편입생 판별, 백엔드 데이터 보정, 졸업요건 계산은 변경하지 않는다.
- 지정과목 크롤링은 실제 `orgClsCd=20` 응답 스키마 확보 후 별도 작업으로 진행한다.

## 현재 상태 분석

- `src/services/merge.ts`는 동일 과목의 수강 데이터가 있을 때 `point == null`이면 `gainPoint`를 복사한다.
- 수강 데이터가 없는 분기는 성적 객체만 복사해 `point`가 없는 상태로 남긴다.
- `src/tests/merge.spec.ts`에는 수강 데이터의 `point=null` 보정 테스트만 있다.

## 결정사항

- 편입인정 과목 코드 목록을 하드코딩하지 않고 모든 성적 데이터에 공통 병합 규칙을 적용한다.
- `credit.gainPoint != null` 조건으로 `0`은 유지하고 `null`과 `undefined`만 제외한다.
- 기존 수강 데이터가 있는 분기의 동작은 변경하지 않는다.

## 구현 및 검증 계획

- 성적 단독, 0, undefined 경계 테스트를 먼저 추가하고 실패를 확인한다.
- 성적 단독 분기에 최소 보정 로직을 추가한다.
- 대상 테스트와 `corepack yarn test` 전체 검증을 실행한다.
- 빌드가 생성한 `dist/*` 변경은 원복하고 소스·테스트·문서만 커밋한다.

## 리스크 및 롤백 포인트

- 소비자가 성적 단독 과목의 `point` 부재에 의존했을 가능성은 낮지만 결과 JSON 필드가 추가될 수 있다.
- 문제가 생기면 해당 병합 분기의 `point` 할당과 회귀 테스트를 한 커밋 단위로 되돌릴 수 있다.

## 진행 기록

- 2026-08-04 기준 전체 테스트 34개가 통과하는 상태에서 작업을 시작했다.
- 성적 단독·`gainPoint=0`·`gainPoint` 누락 회귀 테스트를 `src/tests/merge.spec.ts`에 추가했다.
- 첫 RED 빌드는 TypeScript 대상 라이브러리에 `Object.hasOwn`이 없어 컴파일 오류가 났다. 같은 검증을 `Object.prototype.hasOwnProperty.call`로 변경한 뒤, 성적 단독 `gainPoint=3`과 `0`이 각각 `undefined`로 실패하는 RED를 확인했다.
- `src/services/merge.ts`의 성적 단독 분기에서만 `gainPoint != null`일 때 `point`를 설정했다. 따라서 `0`은 보존되고 `null`·`undefined`는 새 `point` 필드를 만들지 않는다.
- `corepack yarn build && node --test dist/tests/merge.spec.js`에서 병합 테스트 4개가 통과했고, `corepack yarn test`에서 전체 37개가 통과했다.
- 리뷰에서 성적 단독 데이터가 같은 학기·과목으로 중복될 때 최신 `gainPoint`가 결과 `gainPoint`에만 반영되고 `point`는 첫 값으로 남는 문제가 확인됐다.
- 중복 성적의 최신 `gainPoint`, 외부 응답의 명시적 `gainPoint=null`, 실제 수강 데이터의 non-null `point` 우선순위 회귀 테스트를 추가했다. `null` 케이스는 `CreditDTO`가 허용하지 않는 외부 응답 경계를 좁은 `unknown as CreditDTO` 캐스트로 표현했다.
- 기존 객체가 실제 수강 데이터이고 `point`가 non-null이면 값을 보존하고, 그 외에는 각 성적 데이터의 non-null `gainPoint`로 `point`를 갱신하도록 병합 분기를 보정했다.
- RED에서 중복 성적 테스트는 최종 `gainPoint=3`에 대해 `point=2`로 남아 `2 !== 3`으로 실패했다. GREEN 후 `corepack yarn build && node --test dist/tests/merge.spec.js`의 7개와 `corepack yarn test`의 전체 40개가 통과했다.
- 재검토에서 합성된 `point`가 원래 수강 데이터의 non-null `point`로 오인되는 문제가 확인됐다. 이 때문에 원래 `point=null`인 수강 과목의 `gainPoint=2→3` 갱신과 성적 단독의 최신 nullish 처리도 잘못됐다.
- 수강 데이터를 그룹화할 때 학기·과목 키별 원래 `CourseDTO.point`를 `originalCoursePoints`에 별도로 저장했다. 성적을 병합할 때 원래 non-null 값은 보존하고, 원래 null은 최신 `gainPoint` 또는 null로 복원하며, 성적 단독의 최신 nullish 값은 합성 `point`를 삭제한다.
- 원래 수강 `point=null`의 최신 값 갱신, 성적 단독의 최신 `null`·`undefined` 삭제, 원래 수강 null 복원 테스트를 먼저 추가했다. RED에서 각각 `2 !== 3`, own `point` 필드 잔존, `2 !== null`로 실패했고, GREEN 후 대상 11개 및 전체 44개 테스트가 통과했다.
- 2026-08-06에 `feat/19` Docker 이미지를 Linux 컨테이너로 빌드하고 `/health` 200 응답을 확인했다.
- 편입생 실계정에서 `enscDvcd=2`와 편입인정 과목 4건을 확인했다. 각 과목의 인정 학점은 20, 15, 18, 12였고 모두 `point == gainPoint`로 병합됐다.
- 일반 학생 실계정에서도 스크래핑 응답 구조, 일반 과목 수집, `gainPoint`가 있는 과목의 `point` 존재 여부를 점검했고 회귀 검사 스크립트가 통과했다.
