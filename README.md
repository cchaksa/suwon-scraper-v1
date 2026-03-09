# Suwon Scraper

suwon-scraper는 수원대학교 포털 및 학사 시스템 데이터를 크롤링하여 학생의 기본정보, 수강 내역, 성적 정보를 수집하고 가공하는 Node.js 기반의 웹 크롤러입니다. AWS ECS에서 Docker를 이용해 컨테이너로 배포하여 실행할 수 있습니다.

suwon-scraper는 GitHub Actions를 활용하여 Amazon ECS에 자동 배포됩니다. 현재는 운영 계정 내부의 shadow 리소스만 갱신하여 dev 테스트를 수행합니다.

### 주요기능

- 학생 기본 정보 크롤링
- 학기별 성적 및 학점 크롤링
- 수강한 과목 세부 정보 크롤링
- ECS RunTask 1회 실행 비동기 워커
- 결과 콜백 전송(`POST /internal/scrape-results`)

### 기술스택
TypeScript, Node.js, Playwright, Docker, AWS ECS

### 입력 전달 메커니즘 (운영)
- EventBridge Pipe가 shadow SQS 메시지를 읽어 ECS RunTask를 실행한다.
- 운영 태스크는 `WORKER_INPUT_MODE=pipe`로 실행되며, Pipe가 컨테이너 env로 원본 메시지를 직접 주입한다.
- EventBridge Pipes ECS target override의 env 동적 값은 per-record JSON path를 사용한다.
  - `SQS_MESSAGE_BODY=$.body`
  - `SQS_MESSAGE_ID=$.messageId`
- 워커 입력 우선순위:
  - 1순위: `SQS_MESSAGE_BODY`
  - 2순위: `argv[2]`
  - 3순위: `SQS_QUEUE_URL` 기반 SQS poll
- 운영 구성은 `SQS_MESSAGE_BODY` 직접 주입만 허용하며, poll 모드는 로컬/수동 실행 전용이다.
- 워커가 기대하는 실제 포맷:
  - `SQS_MESSAGE_BODY`: SQS message body 원문 JSON string
  - `SQS_MESSAGE_ID`: 실제 SQS messageId 문자열

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
- `NODE_ENV=production`
- `AWS_REGION=ap-northeast-2`
- `WORKER_INPUT_MODE=pipe`
- `SCRAPE_CALLBACK_BASE_URL=https://dev.api.cchaksa.com` (`develop-shadow-*` 경로에서 dev 테스트를 위한 의도된 설정)
- `SCRAPE_CALLBACK_TIMEOUT_MS=5000`
- `SCRAPE_CALLBACK_MAX_RETRIES=3`
- `WORKER_TOTAL_TIMEOUT_MS=120000`
- `WORKER_GRACEFUL_SHUTDOWN_MS=10000`
- `PORTAL_TIMEOUT_MS=60000`
- secret: `SCRAPE_CALLBACK_HMAC_SECRET` (ECS secret 주입)
- 로컬/수동 poll 모드 전용: `SQS_QUEUE_URL`, `SQS_POLL_WAIT_TIME_SECONDS`, `SQS_POLL_VISIBILITY_TIMEOUT_SECONDS`

### 배포 파이프라인
- Terraform apply 없이 스크래핑 리포 CI에서 shadow 리소스만 다음 순서로 배포한다.
  - 1) ECR push
  - 2) ECS task definition revision 등록(새 `IMAGE_URI`)
  - 3) EventBridge Pipe(`develop-shadow-scraper-jobs-to-ecs`) source batch 크기와 target env override를 함께 갱신
- Pipe는 `BatchSize=1`, `MaximumBatchingWindowInSeconds=0`, `SQS_MESSAGE_BODY=$.body`, `SQS_MESSAGE_ID=$.messageId`를 유지한다.
- 배포 대상 리소스는 다음 shadow 기준과 일치해야 한다.
  - ECR repository: `develop-shadow-scraper-worker`
  - Pipe: `develop-shadow-scraper-jobs-to-ecs`
  - Task family: `develop-shadow-scraper-worker`
  - Container name: `worker`
  - CloudWatch log group: `/ecs/develop-shadow-scraper-worker`
- CI 산출물: `IMAGE_URI`, `TASK_DEFINITION_ARN`, `PIPE_TASK_DEFINITION_ARN`
- 실패 시 workflow는 즉시 실패 처리한다. 운영 전환 전까지 `prod-*` 리소스는 갱신하지 않는다.




