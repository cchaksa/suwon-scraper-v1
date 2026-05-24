# prod-deploy-checklist.md

## 작업 체크리스트
- [x] 현재 shadow 전용 배포 설정을 확인한다.
- [x] AWS에서 prod ECR, Pipe, task definition, S3 bucket, Secret ARN, IAM role 이름을 확인한다.
- [x] prod task definition 템플릿을 추가한다.
- [x] GitHub Actions에서 배포 대상을 선택할 수 있게 한다.
- [x] README와 AGENTS.md에 prod 배포 리소스와 환경 변수를 정리한다.
- [x] 변경 파일을 재검토하고 빌드/테스트를 실행한다.

## 검증 결과
- `jq empty task-definition.json task-definition.prod.json` 통과.
- `ruby -e 'require "yaml"; ARGV.each { |path| YAML.load_file(path) }' .github/workflows/deploy-develop.yml .github/workflows/deploy-prod.yml` 통과.
- `jq -e`로 prod task definition의 family, callback URL, result bucket, result prefix, log group 값을 확인했다.
- `npm test` 통과. TypeScript 빌드 후 27개 테스트가 모두 통과했다.

## workflow 분리 변경 체크리스트
- [x] 자동 push 트리거를 제거한다.
- [x] develop 배포 workflow와 prod 배포 workflow를 분리한다.
- [x] 수동 실행 시 GitHub Actions 브랜치 선택으로 배포 대상을 결정하게 한다.
- [x] 두 workflow의 공통 배포 로직을 스크립트로 분리한다.
- [x] README와 AGENTS.md를 새 수동 배포 방식으로 갱신한다.
- [x] workflow/script 문법과 테스트를 다시 검증한다.

## workflow 분리 검증 결과
- `ruby -e 'require "yaml"; ARGV.each { |path| YAML.load_file(path) }' .github/workflows/deploy-develop.yml .github/workflows/deploy-prod.yml` 통과.
- `bash -n .github/scripts/deploy-worker.sh` 통과.
- `jq empty task-definition.json task-definition.prod.json` 통과.
- `git diff --check` 통과.
- `npm test` 통과. TypeScript 빌드 후 27개 테스트가 모두 통과했다.
