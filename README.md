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
- 워커 입력 우선순위:
  - 1순위: `SQS_MESSAGE_BODY`
  - 2순위: `argv[2]`
  - 3순위: `SQS_QUEUE_URL` 기반 SQS poll
- 현재 운영 구성은 `SQS_QUEUE_URL` 기반 poll 모드를 사용한다.

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
- `SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/984762359128/prod-scraper-jobs`
- `SCRAPE_CALLBACK_BASE_URL=https://dev.api.cchaksa.com`
- `SCRAPE_CALLBACK_TIMEOUT_MS=5000`
- `SCRAPE_CALLBACK_MAX_RETRIES=3`
- `WORKER_TOTAL_TIMEOUT_MS=120000`
- `WORKER_GRACEFUL_SHUTDOWN_MS=10000`
- `PORTAL_TIMEOUT_MS=60000`
- secret: `SCRAPE_CALLBACK_HMAC_SECRET` (ECS secret 주입)

### 배포 파이프라인
- Terraform apply 없이 스크래핑 리포 CI에서 다음 순서로 배포한다.
  - 1) ECR push
  - 2) ECS task definition revision 등록(새 `IMAGE_URI`)
  - 3) EventBridge Pipe(`prod-scraper-jobs-to-ecs`) target task definition ARN 갱신
- CI 산출물: `IMAGE_URI`, `TASK_DEFINITION_ARN`, `PIPE_TASK_DEFINITION_ARN`
- 실패 시 workflow는 즉시 실패 처리한다.




