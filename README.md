# Suwon Scraper

suwon-scraper는 수원대학교 포털 및 학사 시스템 데이터를 크롤링하여 학생의 기본정보, 수강 내역, 성적 정보를 수집하고 가공하는 Node.js 기반의 웹 크롤러입니다. AWS ECS에서 Docker를 이용해 컨테이너로 배포하여 실행할 수 있습니다.

suwon-scraper는 GitHub Actions를 활용하여 Amazon ECS에 자동 배포됩니다.

### 주요기능

- 학생 기본 정보 크롤링
- 학기별 성적 및 학점 크롤링
- 수강한 과목 세부 정보 크롤링
- ECS RunTask 1회 실행 비동기 워커
- 결과 콜백 전송(`POST /internal/scrape-results`)

### 기술스택
TypeScript, Node.js, Playwright, Docker, AWS ECS

### 입력 전달 메커니즘 (운영)
- EventBridge Pipe가 SQS 메시지를 읽어 ECS RunTask를 실행한다.
- Pipe target input transform + ECS container override로 워커 컨테이너 환경변수에 메시지를 주입한다.
  - `SQS_MESSAGE_BODY`: 원본 SQS message body(JSON string)
  - `SQS_MESSAGE_ID`: 원본 messageId
- 워커는 `SQS_MESSAGE_BODY`를 1순위로 사용한다. 로컬 실행 시에만 `argv[2]` fallback을 허용한다.
- `NODE_ENV=production`에서 `SQS_MESSAGE_BODY`가 없으면 오배포로 간주하고 실패 종료한다.

### 재시도 책임 경계
- 워커 내부 재시도는 **콜백 전송**(`POST /internal/scrape-results`)에만 적용된다.
- 스크래핑 실패(`retryable=true`)의 최종 재처리는 백엔드가 새 job enqueue로 수행한다.
- RunTask 실패가 SQS 자동 재처리로 복구된다고 가정하지 않는다.

### 콜백 성공 판정
- 기본 성공: 모든 `2xx`
- 중복 성공 허용: `409` (already processed 의미)
- `5xx/timeout/network`는 재시도 대상
- `4xx`(409 제외)는 비재시도 실패

### legacy API 엔드포인트 (`start:server` 실행 시)

| Method | Endpoint  | Request Body                                      | Description          |
|--------|----------|----------------------------------------------------|----------------------|
| POST   | `/auth`  | `{ "username": "학번", "password": "비밀번호" }`   | 사용자 로그인 인증  |
| POST   | `/scrape`| `{ "username": "학번", "password": "비밀번호" }`   | 데이터 크롤링 및 병합 |
| GET    | `/health`| 없음                                               | 서버 상태 확인      |

### 환경변수
- `SQS_MESSAGE_BODY` (운영 입력 필수)
- `SQS_MESSAGE_ID` (선택)
- `SCRAPE_CALLBACK_BASE_URL` (필수)
- `SCRAPE_CALLBACK_HMAC_SECRET` (필수)
- `SCRAPE_CALLBACK_TIMEOUT_MS` (기본 5000)
- `SCRAPE_CALLBACK_MAX_RETRIES` (기본 3)
- `WORKER_TOTAL_TIMEOUT_MS` (기본 120000)
- `WORKER_GRACEFUL_SHUTDOWN_MS` (기본 10000)
- `PORTAL_TIMEOUT_MS` (기본 60000)




