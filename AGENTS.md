# AGENTS.md

## 1) 공통 규칙
- 모든 커뮤니케이션과 산출물은 한국어로 작성한다.
- 작업 전후로 현재 구조를 확인하고, 추측 대신 코드/설정 파일 기준으로 판단한다.
- 작업 완료 후 반드시 double check를 수행한다.
  - 변경 파일 재검토
  - 빌드/실행 가능 여부 확인
  - 영향 범위 점검
- Pull Request 작성 시 PR 템플릿 존재 여부를 먼저 확인한다.
  - 우선 확인 경로: `.github/PULL_REQUEST_TEMPLATE.md`, `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/*.md`
  - 템플릿이 있으면 해당 양식을 반드시 따른다.
- 구조나 변경 사항이 생길 시 `AGENTS.md` 내용을 업데이트 한다.
- 작업으로 인해 본 문서의 내용이 달라졌다면 같은 작업에서 `AGENTS.md`도 갱신한다.

## 2) 프로젝트 개요
- 목적: 수원대학교 포털/학사 시스템에서 학생 정보, 수강 정보, 성적 정보, 편입생 지정과목을 크롤링해 API로 제공
- 런타임: Node.js + TypeScript + Express + Playwright
- 배포: Docker 이미지 빌드 후 Amazon ECS(Fargate) 배포
- 배포: GitHub Actions 수동 실행에서 develop/prod workflow를 선택하고, 실행 화면에서 브랜치 선택
- 성공 워커 콜백은 S3(`SCRAPING_RESULT_BUCKET`)에 저장한 결과 JSON의 키(`result_s3_key`)와 checksum/메타데이터만 전달하며, 백엔드는 이 키로 원문을 조회한다.

## 3) 현재 저장소 구조(핵심)
- `src/worker.ts`: ECS RunTask 비동기 워커 엔트리포인트
- `src/server.ts`: legacy Express 엔트리포인트(`/login`, `/auth`, `/scrape`, `/health`)
- `src/crawlers/*`: 학생/수강/성적/편입생 지정과목 크롤링 API 호출
- `src/services/scrapeJob.ts`: 워커/legacy 서버 공용 스크래핑 코어 로직
- `src/services/portalLogin.ts`: 포털 로그인 및 학사 시스템 세션 핸드오프 공용 로직
- `src/services/callbackClient.ts`: 내부 콜백 API 전송(HMAC/재시도)
- `src/services/payloadValidator.ts`: 워커 입력 스키마 검증
- `src/services/merge.ts`: 성적(Credit) + 수강(Course) 학기별 병합
- `src/tests/*`: 워커/콜백/에러 분류/크롤러 계약 테스트
- `src/dtos/*`: 외부 응답 및 내부 병합 구조 타입 정의
- S3 성공 원문은 `student`, `semesters`, `academicRecords`, `designatedCourses`를 포함하며 비편입생의 `designatedCourses`는 빈 배열이다.
- `src/utils/logger.ts`: 단순 콘솔 로거
- `dist/*`: TypeScript 빌드 산출물
- `.github/workflows/deploy-develop.yml`: develop-shadow ECR 푸시 + ECS task definition 등록 + EventBridge Pipe 갱신
- `.github/workflows/deploy-prod.yml`: prod ECR 푸시 + ECS task definition 등록 + EventBridge Pipe 갱신
- `.github/scripts/deploy-worker.sh`: develop/prod workflow 공용 배포 스크립트
- `task-definition.json`: develop-shadow ECS task 정의
- `task-definition.prod.json`: prod ECS task 정의
- `layer/nodejs/*`, `.serverless/*`: Lambda/Serverless 관련 산출물/의존성(현재 ECS 배포와 별도 히스토리 영역)

## 4) 개발/실행 명령어
- 의존성 설치: `yarn install` (또는 `npm install`)
- 개발 실행(워커): `yarn dev` 또는 `yarn dev:worker`
- 개발 실행(legacy 서버): `yarn dev:server`
- 빌드: `yarn build` (또는 `npm run build`)
- 운영 실행(워커, 빌드 후): `yarn start`
- 운영 실행(legacy 서버): `yarn start:server`
- 테스트: `yarn test` (또는 `npm run test`)

## 5) 구현 규칙
- API/비즈니스 로직 변경은 `src/*` 기준으로 수행한다.
- `dist/*`는 빌드 결과물이므로 직접 수정하지 않는다.
- 크롤링 로직 변경 시 다음을 유지한다.
  - 로그인 실패/계정 잠김 alert 처리
  - `withBrowser` 기반 브라우저/컨텍스트/페이지 종료 보장
  - 외부 응답 누락/null 케이스 방어 로직
- 병합 로직 변경 시 학기 키 규칙(`{year}-{semesterCode}`)과 과목 코드 기준 병합 규칙을 명확히 유지한다.
- 타입 변경 시 관련 DTO, 서비스, 엔드포인트 응답 구조를 함께 맞춘다.
- S3 결과 저장 규칙(`scrape-results/{job_id}/{timestamp}.json`)과 콜백 메타데이터(`result_s3_key`, `result_checksum`, `metadata.*`)를 항상 유지한다.

## 6) 배포 관련 주의사항
- 워커 배포 파이프라인은 자동 push 트리거를 사용하지 않고 수동 실행(`workflow_dispatch`)만 지원한다.
- develop 배포는 `.github/workflows/deploy-develop.yml`, prod 배포는 `.github/workflows/deploy-prod.yml`에서 수행한다.
- 배포할 코드는 GitHub Actions `Run workflow` 화면의 브랜치 선택으로 결정한다.
- 배포 workflow는 ECS 서비스 업데이트를 수행하지 않는다.
- 배포 순서는 `ECR push -> ECS register-task-definition -> EventBridge Pipe update`로 유지한다.
- `.github/scripts/deploy-worker.sh`는 두 workflow 공용 스크립트이므로 대상별 리소스 값은 각 workflow env에서 관리한다.
- shadow 리소스 기준:
  - ECR repository: `develop-shadow-scraper-worker`
  - Pipe: `develop-shadow-scraper-jobs-to-ecs`
  - Task family: `develop-shadow-scraper-worker`
  - Container name: `worker`
  - CloudWatch log group: `/ecs/develop-shadow-scraper-worker`
- prod 리소스 기준:
  - ECR repository: `prod-scraper-worker`
  - Pipe: `prod-scraper-jobs-to-ecs`
  - Task family: `prod-scraper-worker`
  - Container name: `worker`
  - CloudWatch log group: `/ecs/prod-scraper-worker`
  - S3 result bucket: `cck-prod-scrape-results-984762359128`
  - S3 result prefix: `prod/`
  - Callback base URL: `https://api.cchaksa.com`
- 운영 태스크 입력은 `WORKER_INPUT_MODE=pipe` + Pipe env override(`SQS_MESSAGE_BODY`, `SQS_MESSAGE_ID`)를 기준으로 관리한다.
- Pipe env override 값은 SQS source 기준 per-record JSON path(`$.body`, `$.messageId`)를 사용한다.
- 운영 task definition에는 `SQS_QUEUE_URL`을 두지 않고, poll 모드는 로컬/수동 실행 전용으로 본다.
- `SCRAPE_CALLBACK_BASE_URL=https://dev.api.cchaksa.com`는 shadow 경로 dev 테스트를 위한 의도된 설정으로 본다.
- prod task definition의 `SCRAPE_CALLBACK_BASE_URL`는 `https://api.cchaksa.com`로 유지한다.
- task definition의 `SCRAPE_CALLBACK_HMAC_SECRET`는 short name이 아니라 Secrets Manager ARN을 사용해야 한다.
- 현재 기준 값은 `arn:aws:secretsmanager:ap-northeast-2:984762359128:secret:prod/scraper/SCRAPE_CALLBACK_HMAC_SECRET-gr43oy`다.
- 콜백 HMAC 규약은 `HMAC-SHA256`, canonical string `${timestamp}.${rawBody}`, `X-Timestamp`, `X-Signature(hex)`로 고정한다.
- CI 실행 주체는 `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition`, `pipes:DescribePipe`, `pipes:UpdatePipe`, `iam:PassRole` 권한이 필요하다.
- Docker 베이스 이미지는 Playwright 포함 이미지(`mcr.microsoft.com/playwright:v1.41.2-focal`)를 사용한다.

## 7) 변경 후 double check 체크리스트
1. `git diff`로 의도한 파일만 변경되었는지 확인
2. `yarn build` 성공 여부 확인
3. API 변경 시 최소 엔드포인트 수준 점검
   - `GET /health`
   - `POST /login` 로그인 검증/오류 분기
   - `POST /auth` 입력 검증/오류 메시지
   - `POST /scrape` 입력 검증/오류 분기
4. 문서/타입/로직 불일치 여부 확인
5. 필요 시 `AGENTS.md` 동기화 여부 재확인

## 8) PR 작성 규칙
- PR 본문에는 최소한 다음을 포함한다.
  - 변경 목적
  - 주요 변경 사항
  - 검증 방법 및 결과
  - 리스크/롤백 포인트
- PR 템플릿이 있으면 템플릿 섹션을 유지한 채로 작성한다.

## 9) Context 문서 규칙
- 작업 컨텍스트 문서는 `docs/` 하위에 생성한다.
- 파일명은 반드시 `{작업 이름}-context.md` 형식을 따른다.
- 컨텍스트 문서를 작성할 때는 `docs/CONTEXT.md` 규약을 준수한다.
- 컨텍스트 문서는 한국어로 작성하고, 코드/설정 기반 사실과 결정 근거를 함께 기록한다.

## 10) 커밋 규칙
- 브랜치 명은 `feat/{번호}` 형식을 사용한다.
- 커밋 메시지는 `{번호} {커밋 타입}: {한글 메세지}` 형식을 사용한다.
  - 예: `1 feat: 로그인 오류 처리 개선`
