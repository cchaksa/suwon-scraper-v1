# 편입생 지정과목 크롤링 설계

## 요약

편입생에게 지정된 선이수 과목을 포털에서 조회해 S3 스크래핑 원문에 최상위 `designatedCourses` 배열로 추가한다. 비편입생과 정상 빈 응답은 빈 배열을 반환하며 지정과목은 학기별 수강·성적 데이터에 병합하지 않는다.

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
- 요청 헤더는 기존 학적 화면 크롤러와 동일한 JSON·Accept·User-Agent·Referer 구성을 사용하고 body는 `{ sno: username }`으로 보낸다.
- HTTP 성공 응답의 `listPrecpSbjt`가 배열이면 그대로 반환하고, 빈 배열·`null`·누락이면 `[]`를 반환한다.
- 비정상 HTTP 상태는 상태 코드를 포함한 오류로 전파한다.
- `scrapeJob`은 학생 Promise와 수강·성적 요청을 함께 시작한다. 지정과목 Promise는 학생 Promise가 완료된 뒤 `enscDvcd === "2"`일 때만 크롤러를 호출하고, 나머지는 즉시 `[]`를 반환한다.
- 조건부 조합 로직은 인증된 `Page`와 크롤러 의존성을 받는 작은 함수로 분리해 브라우저 실행 없이 단위 테스트한다. 운영 `scrapeJob`은 로그인 후 이 함수를 호출한다.

## 오류 및 경계 조건

- 비편입생은 지정과목 엔드포인트를 호출하지 않는다.
- 편입생의 응답 배열이 없거나 `null`이어도 성공 결과는 `designatedCourses: []`다.
- 편입생의 API가 비정상 HTTP 상태를 반환하면 작업을 실패시켜 불완전한 결과가 S3에 저장되지 않게 한다.
- API 항목의 추가 필드는 런타임에서 제거하지 않는다. 알려진 필드는 DTO로 문서화하고 기존 크롤러처럼 포털 객체를 유지한다.

## 테스트 및 완료 기준

- 크롤러 테스트에서 URL, `{ sno }` body, 정상 배열, 빈 배열, `null`, 키 누락, 비정상 상태를 검증한다.
- 조합 로직 테스트에서 편입생 1회 호출, 비편입생 미호출, 항상 존재하는 결과 배열을 검증한다.
- 워커 저장 테스트 fixture에 `designatedCourses`를 포함하고 S3 저장 payload에 유지되는지 확인한다.
- README, `AGENTS.md`, 작업 컨텍스트 문서가 S3 결과 계약과 일치해야 한다.
- `yarn build`와 `yarn test`가 모두 통과해야 한다.

## 가정

- 편입학 코드 `enscDvcd === "2"`는 기존 `StudentDTO` 계약을 따른다.
- 포털 응답 배열 키는 화면 호출명과 기존 API 규칙에 맞춰 `listPrecpSbjt`를 사용한다.
