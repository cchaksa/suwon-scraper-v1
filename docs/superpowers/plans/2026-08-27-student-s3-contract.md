# 학생 정보 및 S3 결과 계약 구현 계획

> 이 계획은 GitHub 이슈 #24의 학생 정보 회귀 테스트와 S3 원문 계약 문서화를 구현한다.

## 목표

- 포털의 `studentInfo.enscDvcd`와 `studentInfo.flangPassGb`가 `StudentDTO`에 원본 그대로 매핑되는지 보호한다.
- 두 필드가 `ScrapeJobResult.student`까지 유지되는지 보호한다.
- 백엔드가 읽는 S3 원문의 주요 필드 의미와 누락 규칙을 README에 명시한다.

## 구현 단계

1. `src/tests/studentCrawler.spec.ts`를 추가한다.
   - 정상 응답의 `enscDvcd`, `flangPassGb` 원본 매핑을 검증한다.
   - `flangPassGb`가 없는 응답은 기본값 없이 `undefined`로 유지되는지 검증한다.
   - 새 테스트가 필요한 계약을 실제로 검사하는지 RED 상태를 확인한다.
2. `src/tests/scrapeJob.spec.ts`를 보완한다.
   - `ScrapeJobResult.student`에 두 필드가 유지되는지 검증한다.
3. 필요한 최소 구현만 반영한다.
   - 현재 직접 매핑이 테스트를 충족하면 프로덕션 로직은 변경하지 않는다.
4. `README.md`의 S3 원문 구조를 보완한다.
   - `student.enscDvcd`, `student.flangPassGb`, `semesters[].courses[].point`, `semesters[].courses[].gainPoint`, `designatedCourses` 계약을 기록한다.
   - `flangPassGb`가 `undefined`이면 JSON 직렬화 결과에서 속성이 생략됨을 기록한다.
5. 전체 검증과 문서 동기화를 수행한다.
   - 대상 테스트, 전체 테스트, 빌드, `git diff`를 확인한다.
   - 결과를 컨텍스트 문서와 체크리스트에 반영한다.

## 비목표

- 백엔드 졸업요건 분석 로직 구현.
- 포털 응답 값의 비즈니스 해석 또는 정규화.
- `flangPassGb` 누락 시 `null`이나 별도 기본값 부여.
- 새로운 크롤링 API 추가.

## 성공 기준

- `enscDvcd`와 `flangPassGb`의 크롤러 매핑 테스트가 통과한다.
- 누락된 `flangPassGb`가 `undefined`로 유지되는 테스트가 통과한다.
- 두 필드가 최종 결과까지 유지되는 테스트가 통과한다.
- README와 `AGENTS.md`가 실제 구현 계약과 일치한다.
- 전체 테스트와 TypeScript 빌드가 통과한다.
