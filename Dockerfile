# 최신 안정 버전 사용
FROM mcr.microsoft.com/playwright:v1.41.2-focal

WORKDIR /app

# 패키지 파일 복사
COPY package.json yarn.lock ./

# 의존성 설치
RUN yarn install --frozen-lockfile

# 소스 코드 복사
COPY . .

# TypeScript 빌드
RUN yarn build

# 워커 실행 명령 (start = node dist/worker.js)
CMD ["yarn", "start"]
