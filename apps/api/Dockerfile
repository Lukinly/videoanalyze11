FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/testkit/package.json packages/testkit/package.json
RUN pnpm --config.inject-workspace-packages=true install --frozen-lockfile --ignore-scripts
COPY apps/api apps/api
COPY packages/domain packages/domain
COPY scripts/materialize-workspace-package.mjs scripts/materialize-workspace-package.mjs
RUN rm -f apps/api/tsconfig.tsbuildinfo packages/domain/tsconfig.tsbuildinfo
RUN pnpm --config.inject-workspace-packages=true --filter @videoanalyze/domain build
RUN pnpm --filter @videoanalyze/api build
RUN pnpm --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/api deploy --prod /workspace/deploy
RUN pnpm --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/domain deploy --prod /workspace/domain-deploy
RUN node scripts/materialize-workspace-package.mjs /workspace/deploy @videoanalyze/domain /workspace/domain-deploy

FROM node:24-bookworm-slim
WORKDIR /app
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG TARGETARCH
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && printf 'Acquire::Retries "3";\n' > /etc/apt/apt.conf.d/80-retries
RUN --mount=type=cache,id=videoanalyze-apt-${TARGETARCH},target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=videoanalyze-apt-lists-${TARGETARCH},target=/var/lib/apt/lists,sharing=locked \
    sed -i \
      -e "s|http://deb.debian.org/debian-security|http://${APT_MIRROR}/debian-security|g" \
      -e "s|http://deb.debian.org/debian|http://${APT_MIRROR}/debian|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked pip3 install --timeout 60 --retries 3 --break-system-packages yt-dlp==2026.7.4 bilibili-cli==0.6.2
COPY --from=build /workspace/deploy ./
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/src/db/migrations ./dist/db/migrations
COPY --from=build /workspace/apps/api/package.json ./package.json
COPY scripts/load-container-secrets.mjs /app/load-container-secrets.mjs
COPY scripts/configure-storage.mjs /app/configure-storage.mjs
ENV NODE_OPTIONS="--import=/app/load-container-secrets.mjs"
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
