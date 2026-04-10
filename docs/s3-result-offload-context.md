# s3-result-offload-context.md

## 작업 이름
- `s3-result-offload`

## 작업 배경/문제 정의
- 워커가 성공 결과 JSON 전체를 `/internal/scrape-results` 콜백 본문에 포함하면서 payload 크기 증가와 백엔드 응답 지연 시 재전송 문제가 발생했다.
- 결과 원문을 재처리하거나 디버깅할 때 워커가 이미 종료되어 접근할 수 없는 문제가 있었다.

## 목표와 비목표
- **목표**
  - 크롤링 성공 결과를 S3에 저장하고 콜백에는 최소 메타데이터만 전송한다.
  - 업로드 실패 시 워커가 명확한 오류 코드(`RESULT_UPLOAD_FAILED`)로 콜백한다.
  - S3 객체 경로 규칙과 보관 정책을 문서화하고 로그/추적성을 강화한다.
- **비목표**
  - 백엔드 `/internal/scrape-results` API 스펙 변경
  - IaC(Terraform) 반영 및 실제 IAM 배포

## 현재 상태 분석
- `src/worker.ts`는 `result_payload`를 그대로 콜백으로 전송하고 콜백 실패 시 재시도한다.
- `src/types/worker.ts`는 성공 콜백 스키마를 데이터 전체 포함 형태로 정의하고 있다.
- IAM(Task Role)은 현재 S3 PutObject 권한을 명시하지 않는다.

## 결정사항
1. 결과 JSON은 `SCRAPE_RESULT_BUCKET`의 `SCRAPE_RESULT_PREFIX/{job_id}/{YYYYMMDDTHHmmssSSS}.json` 키에 저장한다.
2. 기본 prefix는 `scrape-results/`, timestamp는 `requested_at` 기준 UTC compact 포맷이며, 유효하지 않을 경우 `now()`를 사용한다.
3. 저장 후 콜백 payload는 `result_s3_key`, `result_checksum`, `metadata(bucket, content_length, storage_class, upload_attempt, stored_at, requested_at?, retention_days?)`만 포함한다.
4. 업로드 실패는 `ResultStorageError`로 캡처하고 콜백 `error_code=RESULT_UPLOAD_FAILED`, `retryable=true`로 표준화한다.
5. 로그는 업로드 성공/실패, 콜백 실패 시 `job_id`, `result_s3_key`, `checksum`, `attempt`를 모두 출력한다.
6. 암호화: 기본 `AES256`, `SCRAPE_RESULT_KMS_KEY_ARN`이 설정되면 `aws:kms` + 해당 ARN을 사용한다.
7. 보관 정책: `SCRAPE_RESULT_RETENTION_DAYS` 환경변수로 retention 정보를 메타데이터에 기록하고, 실제 만료는 S3 Lifecycle rule(예: 30일)로 관리한다.

## 구현 계획
1. `@aws-sdk/client-s3` 의존성 추가 및 `WorkerConfig`에 결과 저장 관련 env 로드/검증 추가.
2. `src/services/resultStorage.ts`에서 업로드/키 생성/로그 담당 모듈 구현.
3. `WorkerSuccessResult` 스키마를 S3 키/메타데이터 기반으로 업데이트하고 `handleValidatedJob`에 업로드 단계를 삽입.
4. `ResultStorageError`를 `errorClassifier`에 추가하여 `RESULT_UPLOAD_FAILED`로 매핑.
5. README·AGENTS·컨텍스트 문서를 S3 기반 아키텍처로 갱신하고 `task-definition.json`에 새 환경변수를 명시.
6. 단위/통합 테스트를 갱신하고 업로드 실패 시나리오를 추가한다.

## 검증 계획
- `yarn build` (tsc) 성공 여부 확인.
- `yarn test`를 통해 worker, errorClassifier, callback 경로 회귀.
- 워커 단위 테스트에서 성공 콜백이 S3 키/메타데이터를 포함하는지, 업로드 실패 시 `RESULT_UPLOAD_FAILED`를 반환하는지 확인.
- 로컬에서 `SCRAPE_RESULT_BUCKET` 미설정 시 프로세스가 즉시 실패하는지 확인.

## 리스크 및 롤백 포인트
- S3 PutObject 권한이 누락되면 모든 작업이 `RESULT_UPLOAD_FAILED`로 실패하므로 IAM 업데이트가 필요하다.
- 동일 `job_id`가 반복되면 같은 prefix 하위에 여러 timestamp 파일이 생기므로 백엔드가 최신 버전을 선택해야 한다.
- 롤백 시 `result_payload`를 콜백에 다시 포함해야 하므로 타입/문서 동기화가 필요하다.
