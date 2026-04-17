FROM mcr.microsoft.com/playwright:v1.41.2-focal AS base

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

FROM base AS prod-deps

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=true \
  && yarn cache clean

FROM base AS builder

COPY package.json yarn.lock tsconfig.json tsconfig.runtime.json ./

RUN yarn install --frozen-lockfile \
  && yarn cache clean

COPY src ./src

RUN yarn build:runtime

FROM base AS runtime

ENV NODE_ENV=production

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/worker.js"]
