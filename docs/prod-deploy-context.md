# prod-deploy-context.md

## 작업 이름
- `prod-deploy`

## 작업 배경/문제 정의
- 변경 전에는 기존 단일 배포 workflow와 `task-definition.json`이 `develop-shadow-*` 리소스 기준으로 고정되어 있었다.
- prod 워커 리소스는 AWS 계정 `984762359128`에 이미 존재하지만, 저장소의 배포 파이프라인에서 선택할 수 없다.
- prod Pipe는 현재 task definition만 연결되어 있고, 워커가 요구하는 `SQS_MESSAGE_BODY`, `SQS_MESSAGE_ID` container override가 없는 상태로 확인됐다.

## 목표와 비목표
- **목표**
  - GitHub Actions 배포 workflow를 develop과 prod로 분리한다.
  - 자동 push 배포를 제거하고 수동 실행만 허용한다.
  - 수동 실행 화면에서 선택한 브랜치의 코드를 배포한다.
  - prod task definition 템플릿을 저장소에 추가한다.
  - prod 실행에 필요한 환경 변수와 리소스 값을 README, AGENTS.md에 정리한다.
- **비목표**
  - Terraform 리소스 생성 또는 수정.
  - 현재 작업에서 prod 배포를 실제 실행.
  - 워커 크롤링 로직 변경.

## 변경 전 상태 분석
- 기존 단일 배포 workflow는 `ECR_REPOSITORY=develop-shadow-scraper-worker`, `PIPE_NAME=develop-shadow-scraper-jobs-to-ecs`로 고정되어 있었다.
- `task-definition.json`은 `develop-shadow-scraper-worker` task family와 dev callback URL을 사용한다.
- AWS에서 확인한 prod 값은 다음과 같다.
  - ECR repository: `prod-scraper-worker`
  - Pipe: `prod-scraper-jobs-to-ecs`
  - Task family: `prod-scraper-worker`
  - Log group: `/ecs/prod-scraper-worker`
  - Result bucket: `cck-prod-scrape-results-984762359128`
  - Result prefix: `prod/`
  - Callback base URL: `https://api.cchaksa.com`
  - Secret ARN: `arn:aws:secretsmanager:ap-northeast-2:984762359128:secret:prod/scraper/SCRAPE_CALLBACK_HMAC_SECRET-gr43oy`

## 결정사항
1. 자동 push 배포 트리거는 제거하고 `workflow_dispatch`만 사용한다.
2. develop 배포는 `.github/workflows/deploy-develop.yml`, prod 배포는 `.github/workflows/deploy-prod.yml`로 분리한다.
3. 배포할 코드는 GitHub Actions `Run workflow` 화면에서 선택한 브랜치로 결정한다.
4. task definition 템플릿은 shadow용 기존 `task-definition.json`을 유지하고, prod용 `task-definition.prod.json`을 추가한다.
5. 두 환경 모두 Pipe target override로 `SQS_MESSAGE_BODY=$.body`, `SQS_MESSAGE_ID=$.messageId`를 강제 설정한다.
6. prod task definition에는 코드에서 사용하는 필수/운영 환경 변수만 명시하고, 현재 prod task definition에 남아 있는 미사용 `SCRAPING_RESULT_API_CALL_*` 계열 값은 문서화 대상에서 제외한다.

## 구현 계획
1. `task-definition.prod.json`을 추가해 prod task family, role, callback URL, result bucket/prefix, log group을 명시한다.
2. `.github/workflows/deploy-develop.yml`과 `.github/workflows/deploy-prod.yml`을 추가한다.
3. `.github/workflows/deploy.yml`은 삭제해 자동 push 배포를 제거한다.
4. 공통 배포 절차는 `.github/scripts/deploy-worker.sh`로 분리한다.
5. README와 AGENTS.md의 shadow 전용 설명을 shadow/prod 수동 배포 설명으로 갱신한다.

## 검증 계획
- `jq empty task-definition.json task-definition.prod.json`으로 JSON 문법을 확인한다.
- `ruby -e 'require "yaml"; ARGV.each { |path| YAML.load_file(path) }' .github/workflows/deploy-develop.yml .github/workflows/deploy-prod.yml`로 workflow YAML 문법을 확인한다.
- `bash -n .github/scripts/deploy-worker.sh`로 공용 배포 스크립트 문법을 확인한다.
- `npm test`로 TypeScript 빌드와 기존 테스트를 실행한다.
- `git diff`로 변경 범위가 배포 설정과 문서에 한정됐는지 확인한다.

## 리스크 및 롤백 포인트
- prod workflow를 실행하면 `prod-scraper-worker` ECR, task definition, `prod-scraper-jobs-to-ecs` Pipe가 갱신된다.
- prod 배포 문제가 생기면 직전 task definition revision으로 Pipe target을 되돌리면 된다.
- GitHub Actions prod environment 보호 규칙이 없다면 manual dispatch만으로 prod 갱신이 가능하므로 저장소 설정에서 승인 규칙을 둘지 별도 확인이 필요하다.

## 구현 결과
- 기존 단일 배포 workflow를 삭제해 자동 push 배포를 제거했다.
- `.github/workflows/deploy-develop.yml`과 `.github/workflows/deploy-prod.yml`을 추가했다.
- GitHub Actions `Run workflow` 화면에서 선택한 브랜치의 코드를 배포하도록 했다.
- develop workflow는 `develop-shadow-scraper-worker`, `develop-shadow-scraper-jobs-to-ecs`, `task-definition.json`을 사용하도록 했다.
- prod workflow는 `prod-scraper-worker`, `prod-scraper-jobs-to-ecs`, `task-definition.prod.json`을 사용하도록 했다.
- `.github/scripts/deploy-worker.sh`에 공통 배포 절차를 모았다.
- `task-definition.prod.json`을 추가해 prod callback URL, result bucket/prefix, task role, log group을 명시했다.
- README와 AGENTS.md에 shadow/prod 리소스와 필요한 환경 변수를 정리했다.

## 추가 변경사항
- 사용자 요청에 따라 자동 push 배포를 제거하고 수동 배포만 남겼다.
- 기존 단일 배포 workflow는 삭제하고, `.github/workflows/deploy-develop.yml`과 `.github/workflows/deploy-prod.yml`로 분리했다.
- 배포할 코드는 GitHub Actions `Run workflow` 화면의 브랜치 선택으로 결정한다.
- 두 workflow가 동일한 배포 절차를 공유하도록 `.github/scripts/deploy-worker.sh`를 추가했다.
- develop workflow는 `develop-shadow-*` 리소스와 `task-definition.json`을 사용한다.
- prod workflow는 `prod-*` 리소스와 `task-definition.prod.json`을 사용한다.

## 검증 결과
- `jq empty task-definition.json task-definition.prod.json` 통과.
- `ruby -e 'require "yaml"; ARGV.each { |path| YAML.load_file(path) }' .github/workflows/deploy-develop.yml .github/workflows/deploy-prod.yml` 통과.
- `bash -n .github/scripts/deploy-worker.sh` 통과.
- `jq -e`로 `task-definition.prod.json`의 prod 핵심 값을 확인했다.
- `npm test` 통과. TypeScript 빌드 후 27개 테스트가 모두 통과했다.
