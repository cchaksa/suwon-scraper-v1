# Suwon Scraper

suwon-scraper는 수원대학교 포털 및 학사 시스템 데이터를 크롤링하여 학생의 기본정보, 수강 내역, 성적 정보를 수집하고 가공하는 Node.js 기반의 웹 크롤러입니다. AWS ECS에서 Docker를 이용해 컨테이너로 배포하여 실행할 수 있습니다.

suwon-scraper는 GitHub Actions를 활용하여 Amazon ECS에 배포됩니다. 배포는 자동 push 트리거가 아니라 GitHub Actions 수동 실행으로만 수행하며, 실행 화면에서 배포할 브랜치를 선택합니다.

### 주요기능

- 학생 기본 정보 크롤링
- 학기별 성적 및 학점 크롤링
- 수강한 과목 세부 정보 크롤링
- ECS RunTask 1회 실행 비동기 워커
- 결과 콜백 전송(`POST /internal/scrape-results`)

### 기술스택
TypeScript, Node.js, Playwright, Docker, AWS ECS

### 입력 전달 메커니즘 (운영)
- EventBridge Pipe가 대상 환경의 SQS 메시지를 읽어 ECS RunTask를 실행한다.
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

### 콜백 페이로드 구조
- 성공 콜백은 원문 데이터를 바로 전달하지 않고 S3 객체 메타데이터를 포함한다.
  - `result_s3_key`, `result_checksum`, `metadata(bucket, content_length, storage_class, upload_attempt, stored_at, requested_at?, retention_days?)`
  - 백엔드는 해당 키를 이용해 원본 JSON을 재다운로드한다.
- 실패 콜백은 기존과 동일하게 `error_code`, `error_message`, `retryable` 값을 전달한다.
- S3 업로드에 실패하면 워커는 `RESULT_UPLOAD_FAILED` 오류로 콜백한다.

### legacy API 엔드포인트 (`start:server` 실행 시)

| Method | Endpoint  | Request Body                                      | Description          |
|--------|----------|----------------------------------------------------|----------------------|
| POST   | `/login` | `{ "username": "학번", "password": "비밀번호" }`   | 포털 로그인 및 학사 세션 검증 |
| POST   | `/auth`  | `{ "username": "학번", "password": "비밀번호" }`   | legacy 로그인 검증 alias |
| POST   | `/scrape`| `{ "username": "학번", "password": "비밀번호" }`   | 데이터 크롤링 및 병합 |
| GET    | `/health`| 없음                                               | 서버 상태 확인      |

### 환경변수

#### 공통 런타임 변수
- `NODE_ENV=production`
- `AWS_REGION=ap-northeast-2`
- `WORKER_INPUT_MODE=pipe`
- `SCRAPE_CALLBACK_MAX_RETRIES=3`
- `SCRAPING_RESULT_REGION=ap-northeast-2` (S3 전용 리전)
- `WORKER_TOTAL_TIMEOUT_MS=120000`
- `WORKER_GRACEFUL_SHUTDOWN_MS=10000`
- `PORTAL_TIMEOUT_MS=60000`
- ECS Secret `SCRAPE_CALLBACK_HMAC_SECRET`는 Secrets Manager ARN으로 주입한다.
- ECS Task Role에는 최소한 `s3:PutObject`, `s3:GetObject`, `s3:AbortMultipartUpload`, `s3:ListBucket` 권한을 `SCRAPING_RESULT_BUCKET` prefix 범위로 허용해야 한다.
- 로컬/수동 poll 모드 전용 변수는 `SQS_QUEUE_URL`, `SQS_POLL_WAIT_TIME_SECONDS`, `SQS_POLL_VISIBILITY_TIMEOUT_SECONDS`다.

#### 대상별 런타임 값
| 변수 | develop-shadow | prod |
|------|----------------|------|
| `SCRAPE_CALLBACK_BASE_URL` | `https://dev.api.cchaksa.com` | `https://api.cchaksa.com` |
| `SCRAPE_CALLBACK_TIMEOUT_MS` | `60000` | `5000` |
| `SCRAPING_RESULT_BUCKET` | `cck-develop-shadow-scrape-results-984762359128` | `cck-prod-scrape-results-984762359128` |
| `SCRAPING_RESULT_PREFIX` | `develop-shadow/` | `prod/` |
| `SCRAPE_CALLBACK_HMAC_SECRET` | `arn:aws:secretsmanager:ap-northeast-2:984762359128:secret:prod/scraper/SCRAPE_CALLBACK_HMAC_SECRET-gr43oy` | `arn:aws:secretsmanager:ap-northeast-2:984762359128:secret:prod/scraper/SCRAPE_CALLBACK_HMAC_SECRET-gr43oy` |

#### 선택 변수
- `SCRAPING_RESULT_STORAGE_CLASS`는 미지정 시 `STANDARD`를 사용한다.
- `SCRAPING_RESULT_KMS_KEY_ARN`은 미지정 시 `AES256` 암호화를 사용한다.
- `SCRAPING_RESULT_RETENTION_DAYS`는 메타데이터 기록용 값이다.

#### GitHub Actions 변수와 시크릿
- develop 배포는 `.github/workflows/deploy-develop.yml`을 수동 실행한다.
- prod 배포는 `.github/workflows/deploy-prod.yml`을 수동 실행한다.
- GitHub Actions `Run workflow` 화면에서 배포할 브랜치를 선택한다.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`는 GitHub Secrets로 제공해야 한다.

### 콜백 HMAC 규약
- 알고리즘: `HMAC-SHA256`
- canonical string: `${timestamp}.${rawBody}`
- `timestamp`는 epoch milliseconds 문자열
- `rawBody`는 실제 HTTP request body로 전송되는 `JSON.stringify(payload)` 결과 문자열 그대로 사용한다.
- 헤더:
  - `X-Timestamp`
  - `X-Signature` (hex digest)
- 디버깅 시 워커는 `timestamp`, `hmac_encoding`, `raw_body_hash`, `canonical_string_hash`를 로그에 남긴다.

### 배포 파이프라인
- Terraform apply 없이 스크래핑 리포 CI에서 선택한 대상 환경의 워커 리소스를 다음 순서로 배포한다.
  - 1) ECR push
  - 2) ECS task definition revision 등록(새 `IMAGE_URI`)
  - 3) EventBridge Pipe source batch 크기와 target env override를 함께 갱신
- 자동 배포 트리거는 사용하지 않는다.
- develop 배포는 `Deploy Develop Worker` workflow를 수동 실행하고, prod 배포는 `Deploy Prod Worker` workflow를 수동 실행한다.
- 배포할 코드는 GitHub Actions `Run workflow` 화면의 브랜치 선택으로 결정한다.
- Pipe는 `BatchSize=1`, `MaximumBatchingWindowInSeconds=0`, `SQS_MESSAGE_BODY=$.body`, `SQS_MESSAGE_ID=$.messageId`를 유지한다.
- task definition 렌더 단계에서 `SCRAPE_CALLBACK_HMAC_SECRET`는 반드시 Secrets Manager ARN으로 강제 주입/검증한다.
- 배포 대상 리소스는 다음 기준과 일치해야 한다.

| 항목 | develop-shadow | prod |
|------|----------------|------|
| Workflow | `.github/workflows/deploy-develop.yml` | `.github/workflows/deploy-prod.yml` |
| ECR repository | `develop-shadow-scraper-worker` | `prod-scraper-worker` |
| Pipe | `develop-shadow-scraper-jobs-to-ecs` | `prod-scraper-jobs-to-ecs` |
| Task family | `develop-shadow-scraper-worker` | `prod-scraper-worker` |
| Task definition template | `task-definition.json` | `task-definition.prod.json` |
| Container name | `worker` | `worker` |
| CloudWatch log group | `/ecs/develop-shadow-scraper-worker` | `/ecs/prod-scraper-worker` |

- CI 산출물은 `DEPLOY_ENVIRONMENT`, `GIT_REF_NAME`, `ECR_REPOSITORY`, `IMAGE_URI`, `TASK_DEFINITION_ARN`, `PIPE_TASK_DEFINITION_ARN`을 포함한다.
- 실패 시 workflow는 즉시 실패 처리한다.




