# 스크래핑 워커 비동기 전환 Context

## 작업 이름
- `scraping-worker-async-refactor`

## 작업 배경/문제 정의
- 현재 스크래핑 서버는 `src/server.ts`에서 Express HTTP 엔드포인트(`/auth`, `/scrape`)를 열고 요청-응답 기반으로 동작한다.
- 목표 아키텍처는 ECS RunTask에서 1회 실행되는 비동기 워커이며, 입력은 SQS 메시지 payload로 받고 처리 결과를 내부 콜백 API로 전달해야 한다.
- 기존 방식은 장기적으로 큐 기반 비동기 처리, 재시도 제어, idempotency 보장에 불리하다.

## 목표
- 스크래핑 서버 코드를 HTTP 서버 중심 구조에서 비동기 워커 실행 구조로 전환한다.
- SQS 메시지 입력 검증, 결과 콜백 전송, 에러 분류, 재시도 친화성, 로그/관측성을 확보한다.
- 기존 스크래핑 기능 결과(성공/실패 분기, 데이터 형태, 에러 의미)는 변경하지 않는다.

## 핵심 제약 (최우선)
- 비동기 워커 전환은 **실행 방식 전환**이며, **기존 기능 동작은 유지**해야 한다.
- 기존 크롤링 결과 스키마/의미를 바꾸지 않고, 필요한 경우 어댑터 계층에서만 변환한다.
- 기존 실패 분기(인증 실패, 계정 잠김 등)의 의미와 분류는 유지한 상태에서 워커 에러코드로 매핑한다.

## 비목표 (Out of scope)
- Terraform/IaC 변경
- 백엔드 API 구현 변경
- 프론트엔드 변경

## 범위
- 포함:
  - 워커 진입점 및 실행 흐름 리팩토링
  - SQS 메시지 payload 입력 처리
  - 결과 콜백(`POST /internal/scrape-results`) 전송
  - HMAC 서명 헤더 생성
  - 에러코드 표준화, retryable 분류, timeout/cancel 처리
  - idempotency 책임 경계 명시(워커 무상태 + 백엔드 상태 전이 보장)
  - 테스트 코드 추가/보강
- 제외:
  - ECS 태스크 정의, 네트워크, IAM, SQS 인프라 리소스 수정
  - 백엔드 내부 API 스펙 변경

## 현재 상태 분석 (관련 파일/흐름)
- [src/server.ts](/Users/sangmin8817/.codex/worktrees/2222/suwon-scraper-v1/src/server.ts)
  - Express 앱 실행, `/auth`와 `/scrape`에서 직접 크롤링 수행
  - 로그인/계정잠김 분기 존재
- [src/crawlers/studentCrawler.ts](/Users/sangmin8817/.codex/worktrees/2222/suwon-scraper-v1/src/crawlers/studentCrawler.ts)
- [src/crawlers/courseCrawler.ts](/Users/sangmin8817/.codex/worktrees/2222/suwon-scraper-v1/src/crawlers/courseCrawler.ts)
- [src/crawlers/creditCrawler.ts](/Users/sangmin8817/.codex/worktrees/2222/suwon-scraper-v1/src/crawlers/creditCrawler.ts)
  - Playwright `page.request.post` 기반 포털 API 호출
- [src/services/merge.ts](/Users/sangmin8817/.codex/worktrees/2222/suwon-scraper-v1/src/services/merge.ts)
  - 성적/수강 데이터 병합
- [src/utils/logger.ts](/Users/sangmin8817/.codex/worktrees/2222/suwon-scraper-v1/src/utils/logger.ts)
  - 단순 콘솔 래퍼(구조화 로깅/마스킹 미흡)

## 결정사항

### 1) 워커 실행 모델
- HTTP 서버 대기 방식은 기본 실행 경로에서 제거한다.
- 신규 워커 엔트리포인트(`src/worker.ts`)를 추가하고, 1회 실행 후 프로세스 종료한다.
- 운영 입력 payload는 EventBridge Pipe ECS target container override를 통해 주입되는 `SQS_MESSAGE_BODY`를 기준으로 파싱한다.
- SQS source 기준 실제 env override 규약:
  - `SQS_MESSAGE_BODY=$.body`
  - `SQS_MESSAGE_ID=$.messageId`
- `SQS_MESSAGE_BODY`는 SQS message body 원문 JSON string이어야 하며, literal path 문자열(`$[0].body` 등)은 유효하지 않다.
- 로컬/테스트를 위해 `argv[2]` fallback을 제공한다.
- `NODE_ENV=production`에서 `SQS_MESSAGE_BODY` 미존재 시 오배포로 간주하고 실패 종료한다.

### 2) 입력 스키마
- 표준 입력 타입:
  - `job_id: string`
  - `user_id: string`
  - `portal_type: string`
  - `request_payload: object`
  - `requested_at: string(ISO8601)`
- 스키마 불일치 시:
  - `error_code=INVALID_PAYLOAD`
  - `retryable=false`
  - 즉시 실패 콜백 전송 후 종료

### 3) 출력(콜백) 스키마
- 성공:
  - `job_id`
  - `status: "succeeded"`
  - `result_payload`
  - `finished_at`(ISO8601)
- 실패:
  - `job_id`
  - `status: "failed"`
  - `error_code`
  - `error_message`
  - `retryable`
  - `finished_at`(ISO8601)

### 4) HMAC 서명 규약
- 알고리즘: `HMAC-SHA256`
- 헤더:
  - `X-Timestamp`: epoch milliseconds 문자열
  - `X-Signature`: hex digest
- 서명 원문(canonical string) 상수화:
  - `${timestamp}.${rawBody}`
- `rawBody`는 실제 HTTP request body로 전송되는 `JSON.stringify(payload)` 결과 문자열과 완전히 동일해야 한다.
- 비밀키는 환경변수에서 로드한다.

### 5) idempotency
- idempotency 책임은 백엔드 job 상태 전이(DB 원자 업데이트)로 일원화한다.
- 워커는 DB 직접 연결 없이 무상태(stateless)로 동작한다.
- 중복 콜백 판정은 백엔드 응답(`2xx` 또는 `409`)으로 처리한다.

### 6) 에러 분류 표준
- retryable=true
  - `PORTAL_TIMEOUT`
  - `PORTAL_TEMPORARY_UNAVAILABLE`
  - `CALLBACK_TIMEOUT`
  - `CALLBACK_5XX`
- retryable=false
  - `INVALID_PAYLOAD`
  - `PORTAL_AUTH_FAILED`
  - `PORTAL_ACCOUNT_LOCKED`
  - `BUSINESS_RULE_VIOLATION`
  - `UNKNOWN_NON_RETRYABLE`

### 7) timeout/cancel
- 전체 작업 타임아웃(`WORKER_TOTAL_TIMEOUT_MS`)과 포털 호출 타임아웃(`PORTAL_TIMEOUT_MS`)을 분리한다.
- `SIGTERM`/`SIGINT` 핸들러를 등록하고 graceful shutdown 타임아웃(`WORKER_GRACEFUL_SHUTDOWN_MS`)을 둔다.
- 타임아웃 또는 취소 발생 시:
  - 브라우저/컨텍스트/페이지 정리
  - 결과가 확정되고 `job_id`가 유효하면 종료 전 마지막 콜백 1회 시도
  - `job_id` 누락/무효인 INVALID_PAYLOAD는 콜백 없이 구조화 로그 후 종료

### 8) 관측성/로그
- 모든 로그 필드에 `job_id` 포함
- 최소 로그 이벤트:
  - `job.started`
  - `job.succeeded`
  - `job.failed`
  - `job.finished`(duration_ms 포함)
- 민감정보(`password`, 토큰, 서명 secret)는 마스킹/미출력

## 구현 계획 (단계별)
1. 워커 엔트리포인트 추가 및 기존 `src/server.ts`의 스크래핑 코어 로직 분리
2. 입력/출력 DTO 및 스키마 검증 유틸 추가
3. 에러코드/에러타입 분류 모듈 추가
4. 콜백 클라이언트(HMAC 서명 포함) 추가
5. 재시도 책임 경계(콜백 재시도 vs 백엔드 재큐잉) 반영
6. timeout/cancel 처리 및 자원 정리 보강
7. 로거 개선(`job_id`, `duration_ms`, 민감정보 마스킹)
8. 테스트 케이스 구현 및 회귀 점검

## 검증 계획 (테스트/체크리스트)
- 기능 동등성 회귀:
  - 기존 `/scrape` 경로 기준 대표 시나리오의 결과와 워커 결과를 동일 입력으로 비교
  - 학생/수강/성적 병합 결과 필드/값 의미가 달라지지 않았는지 확인
- 정상 처리:
  - 유효 payload 입력 시 succeeded 콜백 1회 전송
- 입력 스키마 오류:
  - INVALID_PAYLOAD + retryable=false 반환
- `job_id` 누락/무효:
  - 실패 콜백 미전송 + 구조화 로그 + exit 1
- 포털 일시 실패:
  - retryable=true 코드 매핑 확인
- 포털 영구 실패:
  - retryable=false 코드 매핑 확인
- 콜백 API 장애:
  - 5xx/timeout 재시도 정책 동작 확인
- 콜백 중복 처리:
  - `2xx` 우선 성공 판정 + `409` 중복 성공 허용 확인
- 중복 실행:
  - 동일 `job_id` 2회 실행 시 외부 호출/콜백 중복 방지 확인

## 추가 환경변수(예정)
- `SCRAPE_CALLBACK_BASE_URL`
- `SCRAPE_CALLBACK_HMAC_SECRET`
- `SCRAPE_CALLBACK_TIMEOUT_MS`
- `SCRAPE_CALLBACK_MAX_RETRIES`
- `WORKER_TOTAL_TIMEOUT_MS`
- `WORKER_GRACEFUL_SHUTDOWN_MS`
- `PORTAL_TIMEOUT_MS`
- `SQS_MESSAGE_BODY` (EventBridge Pipe/ECS override 주입)
- `SQS_MESSAGE_ID` (로그 상관관계)

## shadow E2E 반영 메모
- `develop-shadow` 환경 E2E에서 ECS RunTask와 secret injection, log delivery는 정상 동작했다.
- 초기 Pipe 설정의 `"$[0].body"`, `"$[0].messageId"`는 literal string으로 주입되어 워커 JSON parse가 실패했다.
- 수정 후 기준은 per-record JSON path `$.body`, `$.messageId`이다.
- shadow 태스크의 콜백 비밀키는 short name이 아니라 Secrets Manager ARN을 사용해야 한다.
- 현재 기준 값은 `arn:aws:secretsmanager:ap-northeast-2:984762359128:secret:prod/scraper/SCRAPE_CALLBACK_HMAC_SECRET-gr43oy`다.

## 결과물 형식 (산출물 보고 템플릿)
1. 변경 파일 목록
2. 핵심 변경 코드(diff)
3. 추가 환경변수 목록
4. 테스트 결과 요약
5. 남은 리스크/추가 TODO

## 리스크 및 롤백 포인트
- idempotency는 백엔드 상태 전이 보장에 의존하므로 백엔드/DB 일관성 정책이 전제되어야 함
- 콜백 재시도 정책은 백엔드 수용량/중복 처리 정책과 맞춰야 함
- 롤백 시 HTTP 서버 기반 기존 엔트리포인트를 재활성화할 수 있도록 최소 분리 전략 유지

## 가정
- 백엔드는 `POST /internal/scrape-results` 스키마를 그대로 수용한다.
- ECS RunTask 입력 payload는 EventBridge Pipe target transform + ECS container override를 통해 환경변수로 주입된다.
