FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web apps/web
COPY packages/domain packages/domain
RUN rm -f packages/domain/tsconfig.tsbuildinfo
RUN pnpm --filter @videoanalyze/domain build
RUN pnpm --filter @videoanalyze/web build

FROM nginx:stable-alpine
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
