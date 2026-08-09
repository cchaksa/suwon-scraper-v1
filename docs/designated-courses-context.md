# 편입생 지정과목 크롤링 컨텍스트

## 작업 이름

- `designated-courses`
- GitHub 이슈 `#21`

## 작업 배경/문제 정의

- 현재 `scrapeJob` 결과는 학생 정보, 학기별 수강·성적 정보, 전체 성적 요약만 제공한다.
- 편입생에게 학교가 지정한 선이수 과목은 포털의 별도 탭에서 제공되지만 현재 S3 결과에는 포함되지 않는다.
- 백엔드는 성공 콜백의 `result_s3_key`로 원문을 읽으므로 지정과목도 같은 결과 계약에 포함해야 한다.

## 목표와 비목표

### 목표

- 편입생 지정과목 API를 크롤링한다.
- `student.enscDvcd === "2"`인 경우에만 API를 호출한다.
- 모든 성공 결과에서 `designatedCourses` 배열을 보장한다.
- 빈 응답과 `listPrecpSbjt` 누락을 빈 배열로 정규화한다.
- S3 결과 계약과 테스트를 함께 갱신한다.

### 비목표

- 지정과목을 `semesters[].courses`에 병합하지 않는다.
- 지정과목 이수 여부를 별도로 판정하지 않는다.
- 백엔드의 S3 조회 로직은 변경하지 않는다.
- 외국어 인증 필드의 별도 회귀 테스트는 이슈 범위에 포함하지 않는다.

## 현재 상태 분석

- `src/services/scrapeJob.ts`는 로그인 후 학생·수강·성적 크롤러를 병렬 호출한다.
- `src/services/resultStorage.ts`는 `scrapeJob` 결과를 별도 가공 없이 JSON 직렬화해 S3에 저장한다.
- 편입생 포털 화면에서 `POST /precpSbjt/listPrecpSbjt.do` 호출을 확인했다.
- 지정과목 그리드의 데이터 필드는 `orgClsCd`, `subjtCd`, `subjtNm`, `point`, `precpResnCd`, `cretGainYear`, `cretSmrNm`, `sno`다.
- 현재 작업 트리의 `.gitignore` 변경은 사용자 소유 변경이므로 이 작업에서 수정하거나 커밋하지 않는다.

## 결정사항

1. S3 결과의 최상위 필드명은 `designatedCourses`로 정한다.
2. 포털 응답 배열 키는 `listPrecpSbjt`를 사용한다.
3. 비편입생은 API를 호출하지 않고 `designatedCourses: []`를 반환한다.
4. 편입생의 정상 빈 응답 또는 배열 키 누락도 `[]`로 정규화한다.
5. 편입생 API가 비정상 HTTP 상태를 반환하면 다른 핵심 크롤러와 동일하게 작업을 실패시킨다.
6. 학생·수강·성적 요청의 기존 병렬성을 유지하되 지정과목 요청은 학생 정보 Promise가 편입생으로 판정된 뒤 시작한다.
7. 지정과목은 수강·성적과 의미가 다르므로 학기 병합 결과에 넣지 않는다.

## 구현 계획

1. `DesignatedCourseDTO`와 `scrapeDesignatedCourses`를 테스트 우선으로 추가한다.
2. 인증된 페이지에서 실행되는 스크래핑 조합 로직에 작은 테스트 경계를 두고 조건부 호출을 검증한다.
3. `ScrapeJobResult`에 `designatedCourses`를 추가한다.
4. 워커 테스트 fixture와 S3 결과 계약 문서를 새 필드에 맞게 갱신한다.
5. 저장소 구조가 바뀌므로 `AGENTS.md`의 핵심 구조와 결과 계약을 동기화한다.

## 검증 계획

- 정상 응답에서 지정과목 배열과 필드가 유지되는지 확인한다.
- `listPrecpSbjt`가 빈 배열, `null`, 누락인 경우 `[]`인지 확인한다.
- 편입생은 지정과목 API를 한 번 호출하고 비편입생은 호출하지 않는지 확인한다.
- 지정과목 API 비정상 상태가 오류로 전파되는지 확인한다.
- 저장 대상으로 전달되는 결과에 `designatedCourses`가 항상 존재하는지 확인한다.
- `yarn build`와 `yarn test`를 실행한다.

## 리스크 및 롤백 포인트

- `enscDvcd` 코드 계약이 바뀌면 조건부 호출이 누락될 수 있으므로 코드 `"2"`를 테스트로 고정한다.
- 지정과목 API 장애는 편입생 작업 전체를 실패시키므로 운영 장애 시 이 필드만 빈 배열로 처리할지 별도 정책 결정이 필요하다.
- 롤백 시 DTO·크롤러·`ScrapeJobResult` 필드를 함께 제거하고 결과 계약 문서를 되돌린다.

## 구현 결과

- `DesignatedCourseDTO`와 `scrapeDesignatedCourses`를 추가했다.
- `scrapeAuthenticatedData`가 편입생에게만 지정과목 API를 호출한다.
- 모든 성공 결과와 S3 저장 payload가 `designatedCourses` 배열을 포함한다.
- README와 `AGENTS.md`를 최종 결과 계약에 맞게 동기화했다.

## 검증 결과

- `yarn build`: 성공.
- `yarn test`: 성공.
