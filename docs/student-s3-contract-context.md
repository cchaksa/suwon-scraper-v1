# student-s3-contract-context.md

## 작업 이름

- 학생 정보 및 S3 스크래핑 결과 계약 보호.

## 작업 배경/문제 정의

- 백엔드는 S3에 저장된 스크래핑 원문 JSON을 읽어 졸업요건을 분석한다.
- `student.enscDvcd`와 `student.flangPassGb`는 이미 크롤러가 전달하지만 전용 매핑 회귀 테스트가 없다.
- 편입 인정 학점과 지정과목이 추가된 뒤에도 백엔드가 의존하는 주요 필드의 의미와 누락 규칙이 한곳에 충분히 문서화되지 않았다.

## 목표와 비목표

### 목표

- 학생 정보 응답의 `enscDvcd`와 `flangPassGb` 원본 매핑을 테스트로 보호한다.
- 두 필드가 최종 `ScrapeJobResult.student`까지 유지됨을 보호한다.
- S3 원문의 학생·학점·지정과목 계약을 README에 문서화한다.

### 비목표

- 백엔드 졸업요건 분석 로직을 구현하지 않는다.
- 포털 응답의 의미를 새로 해석하거나 값을 정규화하지 않는다.
- 새로운 포털 크롤링 API를 추가하지 않는다.

## 현재 상태 분석

- `src/crawlers/studentCrawler.ts`는 `studentInfo.enscDvcd`와 `studentInfo.flangPassGb`를 직접 반환한다.
- `src/dtos/StudentDTO.ts`에서 `enscDvcd`는 필수 문자열이고 `flangPassGb`는 선택 문자열이다.
- `src/services/scrapeJob.ts`는 크롤러가 반환한 `student` 객체를 수정 없이 최종 결과에 포함한다.
- `src/services/resultStorage.ts`는 최종 결과를 `JSON.stringify`하여 S3에 저장한다.
- JavaScript JSON 직렬화 규칙에 따라 값이 `undefined`인 객체 속성은 저장된 JSON에서 생략된다.

## 결정사항

- `flangPassGb`는 포털 원본 문자열을 해석하거나 변환하지 않는다.
- 포털 응답에서 `flangPassGb`가 누락되면 별도 기본값을 넣지 않고 현재 동작처럼 `undefined`를 유지한다.
- 따라서 S3 JSON에서는 누락된 `student.flangPassGb` 속성이 생략될 수 있다.
- 현재 프로덕션 매핑이 계약을 이미 만족하면 테스트와 문서만 추가하고 로직은 변경하지 않는다.

## 구현 계획

1. 학생 정보 크롤러의 정상·누락 응답 계약 테스트를 추가한다.
2. 최종 스크래핑 결과의 학생 필드 보존 테스트를 추가한다.
3. README에 주요 S3 원문 필드 계약을 기록한다.
4. `AGENTS.md`와 실제 구조의 일치 여부를 재검토한다.

## 검증 계획

- 새 회귀 테스트의 RED 상태를 확인한다.
- 대상 테스트와 전체 `yarn test`를 실행한다.
- `yarn build`를 실행한다.
- `git diff`로 의도한 파일만 변경됐는지 확인한다.

## 리스크 및 롤백 포인트

- 백엔드가 `student.flangPassGb`의 항상 존재를 가정하면 누락 응답에서 문제가 될 수 있으므로 README에 생략 가능성을 명시한다.
- 이 작업은 기존 런타임 값을 변경하지 않으므로 롤백은 테스트와 문서 변경을 되돌리는 것으로 충분하다.

## 구현 및 검증 결과

- `src/tests/studentCrawler.spec.ts`에 `enscDvcd`, `flangPassGb` 원본 매핑과 `flangPassGb` 누락 시 `undefined` 유지 테스트를 추가했다.
- `src/tests/scrapeJob.spec.ts`에서 두 필드가 최종 `student` 결과에 유지되는지 검증했다.
- 테스트 추가 후 학생 크롤러 매핑을 임시로 제거한 변이 상태에서 대상 테스트가 `'' !== '2'`로 실패하는 RED 상태를 확인하고 원래 매핑을 복원했다.
- 기존 프로덕션 매핑이 계약을 만족하므로 런타임 로직은 변경하지 않았다.
- `README.md`와 `AGENTS.md`에 S3 원문 필드 의미와 `flangPassGb` 생략 규칙을 반영했다.
- `corepack yarn test` 실행 결과 TypeScript 빌드와 전체 테스트 55개가 통과했다.
- `feat/24` Docker 이미지의 legacy `/scrape`를 편입생 실계정으로 호출해 HTTP 성공 응답을 확인했다.
- 실계정 결과에서 S3 원문의 최상위 구조와 `student.enscDvcd`, `student.flangPassGb` 원본값 보존을 확인했다.
- `gainPoint`가 존재하는 과목의 `point` 보정 계약과 `designatedCourses` 배열 계약을 확인했다.
- 테스트 계정에는 `flangPassGb`가 존재했으므로 필드 누락 시 `undefined` 계약은 단위 테스트로 검증했다.
