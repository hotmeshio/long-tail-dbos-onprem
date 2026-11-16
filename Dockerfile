# Long Tail on DBOS for a factory site. The same image runs the mock printer.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY lines ./lines
COPY src ./src
COPY mock ./mock
CMD ["npx", "tsx", "watch", "src/index.ts"]

FROM dev AS builder
RUN npm run build

FROM ${NODE_IMAGE} AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY lines ./lines
COPY --from=builder /app/build ./build
EXPOSE 3000 3001
CMD ["node", "build/src/index.js"]
