# 편입생 지정과목 크롤링 설계

## 요약

학부 편입생에게 지정된 선이수 과목을 포털에서 조회해 S3 스크래핑 원문에 최상위 `designatedCourses` 배열로 추가한다. 비편입생과 정상 빈 응답은 빈 배열을 반환하며 지정과목은 학기별 수강·성적 데이터에 병합하지 않는다. 대학원 지정과목 수집은 지원 범위 밖이다.

## 외부 계약

`ScrapeJobResult`에 다음 필드를 추가한다.

```ts
interface ScrapeJobResult {
  student: StudentDTO;
  semesters: MergedSemesterDTO[];
  academicRecords: GradeResponseDTO;
  designatedCourses: DesignatedCourseDTO[];
}
```

`DesignatedCourseDTO`는 포털 그리드에서 확인한 다음 필드를 표현한다.

```ts
interface DesignatedCourseDTO {
  orgClsCd: string;
  subjtCd: string;
  subjtNm: string;
  point: number;
  precpResnCd: string;
  cretGainYear: string;
  cretSmrNm: string;
  sno: string;
}
```

모든 성공 결과는 편입 여부와 관계없이 `designatedCourses`를 배열로 포함한다. JSON 직렬화 과정에서 기존 `student`, `semesters`, `academicRecords` 구조는 변경하지 않는다.

## 구성과 데이터 흐름

- `scrapeDesignatedCourses(page, username)`는 `POST https://info.suwon.ac.kr/precpSbjt/listPrecpSbjt.do`를 호출한다.
- 요청 헤더는 기존 학적 화면 크롤러와 동일한 JSON·Accept·User-Agent·Referer 구성을 사용하고 body는 `{ sno: username, orgClsCd: "20" }`으로 보낸다.
- 학부 조회 조건은 `UNDERGRADUATE_ORG_CLASS_CODE = "20"`으로 명시한다. 학생 응답의 `orgClsCd`는 요구하지 않으며 DTO나 호출 인자에 추가하지 않는다.
- HTTP 성공 응답의 `precpSbjtList`가 배열이면 그대로 반환한다. 명시적인 빈 배열은 정상 결과이며, 키 누락·null·배열이 아닌 값·JSON 구문 오류는 `PORTAL_RESPONSE_SCHEMA_MISMATCH`, `retryable: false`로 실패 처리한다.
- 비정상 HTTP 상태는 상태 코드를 포함한 오류로 전파한다.
- `scrapeJob`은 학생 Promise와 수강·성적 요청을 함께 시작한다. 지정과목 Promise는 학생 Promise가 완료된 뒤 `enscDvcd === "2"`일 때만 크롤러를 호출하고, 나머지는 즉시 `[]`를 반환한다.
- 조건부 조합 로직은 인증된 `Page`와 크롤러 의존성을 받는 작은 함수로 분리해 브라우저 실행 없이 단위 테스트한다. 운영 `scrapeJob`은 로그인 후 이 함수를 호출한다.

## 오류 및 경계 조건

- 비편입생은 지정과목 엔드포인트를 호출하지 않는다.
- 편입생의 응답 형식 오류는 전체 작업 실패로 전파한다. S3 결과 저장과 성공 콜백을 생략하고 실패 콜백을 전송한다.
- JSON 구문 오류 메시지는 원문을 포함하지 않는다. 응답 본문을 읽는 중 발생한 통신 오류는 기존 오류 분류와 재시도 정책을 유지한다.
- 편입생의 API가 비정상 HTTP 상태를 반환하면 작업을 실패시켜 불완전한 결과가 S3에 저장되지 않게 한다.
- API 항목의 추가 필드는 런타임에서 제거하지 않는다. 알려진 필드는 DTO로 문서화하고 기존 크롤러처럼 포털 객체를 유지한다.

## 테스트 및 완료 기준

- 크롤러 테스트에서 URL, `{ sno, orgClsCd: "20" }` body, 정상 배열, 빈 배열, 잘못된 키, null, 키 누락, 타입 오류, JSON 구문 오류, 비정상 상태를 검증한다.
- 조합 로직 테스트에서 편입생 1회 호출, 비편입생 미호출, 항상 존재하는 결과 배열을 검증한다.
- 실제 지정과목 크롤러와 조합 로직을 거친 결과가 워커의 S3 저장 payload에 유지되고, 형식 오류 시 S3 저장 없이 실패 콜백만 전달되는지 확인한다.
- 학생 정보에 `orgClsCd`가 없어도 학부 코드로 요청하고, 지정과목이 없는 편입생의 빈 배열은 성공 저장·콜백으로 처리되는지 확인한다.
- README, `AGENTS.md`, 작업 컨텍스트 문서가 S3 결과 계약과 일치해야 한다.
- `yarn build`와 `yarn test`가 모두 통과해야 한다.

## 가정

- 편입학 코드 `enscDvcd === "2"`는 기존 `StudentDTO` 계약을 따른다.
- 2026-09-27 실제 포털 응답에서 확인한 배열 키는 `precpSbjtList`다. #26에서 기존 `listPrecpSbjt` 가정과 누락 정규화 정책을 정정했다.
- 같은 로그인 세션에서 학번만 전송하면 0개, `orgClsCd: "20"`을 함께 전송하면 확인 대상 학생의 지정과목 3개가 반환됐다. #28에서 요청 조건을 보완하며, 정상 빈 배열 허용은 유지한다.
- [포털 공식 공통 교과목 스크립트](https://info.suwon.ac.kr/js/sa/commSa.js)의 `openSubjtPopUp`·`openSubjtGridPopUp`은 학부에 `"20"`, 대학원에 `"30"`을 설정한다. 사용자가 학부 전용 범위에서 `"20"`을 유지하도록 결정했다.
