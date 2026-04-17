# 작업 이름
- worker-image-optimization

## 작업 배경/문제 정의
- `develop-shadow` 스크래핑 worker는 ECS RunTask 이후 컨테이너 시작 구간에서 image pull 비중이 크다.
- 최근 성공 요청 기준 전체 소요 `85.837초` 중 `outbox.sent -> worker job.started`가 `69.773초`, image pull이 `45.516초`를 차지했다.
- 비용 최소화가 우선순위라서 warm worker 같은 상시 비용 구조는 제외하고, 이미지 자체와 레이어 구조 최적화로 pull 시간을 줄여야 한다.

## 목표와 비목표
- 목표
  - runtime 이미지에 필요한 파일과 dependency만 포함한다.
  - Docker build context를 줄이고, 자주 바뀌는 레이어를 뒤로 이동한다.
  - Playwright base 이미지는 유지하면서 multi-stage build로 worker 전용 런타임 이미지를 만든다.
- 비목표
  - 크롤링/콜백/S3 업로드 등 비즈니스 로직 변경
  - warm worker, 장기 실행 서비스, ECS 구조 변경
  - custom Chromium 런타임 재구성

## 현재 상태 분석
- `Dockerfile`
  - 단일 스테이지 구성이다.
  - `COPY . .` 이후 `yarn install`, `yarn build`를 수행해 build cache 효율이 낮다.
  - runtime 이미지에 source, docs, `.serverless`, `layer`까지 포함될 수 있다.
- `package.json`
  - runtime 코드는 `playwright-core`만 직접 사용한다.
  - `playwright`, `@playwright/test`는 현재 코드 사용 흔적이 없다.
  - `playwright-core` 버전이 base 이미지와 맞지 않아 lockfile에 중복 버전이 남아 있다.
- Docker context
  - `.dockerignore`가 없어서 `.serverless`, `layer`, `docs`, `dist` 등이 모두 build context에 포함된다.

## 결정사항
- base 이미지는 `mcr.microsoft.com/playwright:v1.41.2-focal`로 유지한다.
- `prod-deps`, `builder`, `runtime` 3단계 multi-stage build를 적용한다.
- intermediate stage(`prod-deps`, `builder`)는 `node:20-bookworm-slim`을 사용해 CI/CD build 부담을 줄이고, 최종 runtime만 Playwright 이미지를 사용한다.
- Docker runtime 빌드는 `tsconfig.runtime.json`을 사용해 `src/tests/**/*`를 제외한다.
- runtime dependency는 `playwright-core@1.41.2` 포함 production dependency만 유지한다.
- `.dockerignore`로 이미지 빌드에 불필요한 파일을 context 단계에서 제외한다.

## 구현 계획
1. `Dockerfile`을 multi-stage 구조로 변경한다.
2. `package.json`에 `build:runtime` 스크립트를 추가하고 미사용 Playwright 패키지를 제거한다.
3. `tsconfig.runtime.json`을 추가해 runtime 빌드 범위를 고정한다.
4. `.dockerignore`를 추가해 context 부피를 줄인다.
5. 의존성 lockfile을 갱신하고 `yarn build`, `yarn test`로 검증한다.
6. 가능하면 Docker daemon 환경에서 build context/이미지 크기 비교를 수행한다.

## 검증 계획
- `yarn build`
- `yarn test`
- `git diff`로 변경 범위 확인
- Docker daemon이 가능하면 아래도 확인
  - `docker build` 전후 시간 비교
  - `docker image inspect`, `docker history`로 이미지 크기/레이어 비교
  - runtime 이미지에 `src`, `.serverless`, `layer`, dev dependency 미포함 확인

## 리스크 및 롤백 포인트
- Playwright base 이미지는 유지하므로 가장 큰 브라우저 레이어는 그대로 남는다.
- 이번 변경은 app 레이어와 context 최적화 중심이라 cold host의 pull 시간 절감 폭에는 한계가 있다.
- 문제가 생기면 `Dockerfile`, `.dockerignore`, `package.json`, `tsconfig.runtime.json` 변경만 롤백하면 된다.
