# login-endpoint-context.md

## 작업 이름
- `login-endpoint`

## 작업 배경/문제 정의
- 백엔드가 스크래핑 job 생성 전에 포털 ID/PW 유효성을 빠르게 확인해야 한다.
- 현재 `src/server.ts`에는 `POST /auth`가 있지만 `POST /login`은 없다.
- 현재 `/auth`는 포털 로그인까지만 확인하고 `https://info.suwon.ac.kr/sso_security_check` 세션 핸드오프는 수행하지 않는다.
- 현재 `/auth`는 ID/PW 오류와 계정 잠금을 HTTP status로 구분하지 않고 `500`으로 반환한다.

## 목표와 비목표
- **목표**
  - `POST /login`을 추가한다.
  - 성공 기준은 포털 로그인 성공과 학사 시스템 세션 핸드오프 성공으로 둔다.
  - ID/PW 오류는 `401`, 계정 잠금은 `423`, 시스템성 오류는 `5xx`로 반환한다.
  - `/login` 호출에서는 학생, 수강, 성적 크롤러를 실행하지 않는다.
  - 기존 `/scrape` 전체 스크래핑 결과와 worker/result/callback 계약은 변경하지 않는다.
- **비목표**
  - 백엔드 `POST /portal/link` 구현 변경
  - SQS, ECS, S3, callback payload 계약 변경
  - 포털 데이터 크롤러 응답 스키마 변경

## 현재 상태 분석
- `src/server.ts`
  - `/auth`, `/scrape`, `/health`를 정의한다.
  - `/auth` 안에 로그인 처리 코드가 직접 들어 있다.
  - `/scrape`는 `scrapeJob`을 호출하고 `ScrapeJobError`를 `401`, `423`, `500`으로 매핑한다.
- `src/services/scrapeJob.ts`
  - 포털 로그인, 학사 시스템 세션 핸드오프, 학생/수강/성적 크롤러 호출을 한 함수에서 처리한다.
  - 로그인 dialog 처리 로직이 `/auth`와 중복되어 있다.
- `src/services/withBrowser.ts`
  - Playwright browser/context/page 생성과 `finally` 정리를 담당한다.

## 결정사항
1. 로그인과 세션 핸드오프를 `src/services/portalLogin.ts` helper로 분리한다.
2. `scrapeJob`은 같은 browser page에서 helper를 실행한 뒤 기존 크롤러를 호출한다.
3. `/login`과 `/auth`는 helper를 호출하되 크롤러와 result storage, callback은 호출하지 않는다.
4. `/login` 성공 응답은 body가 필요 없으므로 `204 No Content`를 사용한다.
5. `/auth`는 legacy 호환을 위해 기존 JSON 성공 응답을 유지하되 내부 로직은 helper만 호출한다.
6. Express 앱을 테스트 가능하게 `createApp`으로 분리하고 직접 실행 시에만 listen한다.

## 구현 계획
1. HTTP 라우트 테스트를 먼저 추가하고 현재 코드에서 실패를 확인한다.
2. `portalLogin` helper를 추가해 중복 로그인 로직을 이동한다.
3. `scrapeJob`이 helper를 사용하도록 수정한다.
4. `server.ts`에 `POST /login`을 추가하고 `/auth`를 helper alias로 정리한다.
5. 테스트와 빌드를 실행하고 변경 범위를 재검토한다.

## 검증 계획
- `npm test`로 TypeScript 빌드와 전체 node test를 실행한다.
- 테스트에서 확인할 항목은 다음과 같다.
  - `POST /login` 성공 시 `204` 반환
  - 인증 실패 시 `401` 반환
  - 계정 잠금 시 `423` 반환
  - 시스템성 오류 시 `500` 반환
  - `/login` 호출이 `/scrape`용 크롤링 함수를 호출하지 않음

## 리스크 및 롤백 포인트
- `/login` 성공 기준에 `sso_security_check`가 포함되므로 포털 로그인만 하던 기존 `/auth`보다 성공 판정 시간이 길어질 수 있다.
- `/auth`가 helper를 공유하면서 계정 오류 status가 기존 `500`에서 `401` 또는 `423`으로 바뀔 수 있다.
- 롤백 시 `server.ts`에서 `/login` 라우트를 제거하고 `scrapeJob`의 helper 호출을 기존 인라인 로그인 코드로 되돌리면 된다.
