FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN pnpm config set registry ${NPM_REGISTRY}
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/testkit/package.json packages/testkit/package.json
RUN pnpm --config.inject-workspace-packages=true install --frozen-lockfile --ignore-scripts
COPY apps/worker apps/worker
COPY packages/domain packages/domain
COPY scripts/materialize-workspace-package.mjs scripts/materialize-workspace-package.mjs
RUN rm -f apps/worker/tsconfig.tsbuildinfo packages/domain/tsconfig.tsbuildinfo
RUN pnpm --config.inject-workspace-packages=true --filter @videoanalyze/domain build
RUN pnpm --filter @videoanalyze/worker build
RUN pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/worker deploy --prod /workspace/deploy
RUN pnpm --prefer-offline --config.inject-workspace-packages=true --ignore-scripts --filter @videoanalyze/domain deploy --prod /workspace/domain-deploy
RUN node scripts/materialize-workspace-package.mjs /workspace/deploy @videoanalyze/domain /workspace/domain-deploy

FROM node:24-bookworm-slim
WORKDIR /app
ARG APT_MIRROR=deb.debian.org
ARG TARGETARCH
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && printf 'Acquire::Retries "3";\n' > /etc/apt/apt.conf.d/80-retries
RUN --mount=type=cache,id=videoanalyze-apt-${TARGETARCH},target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=videoanalyze-apt-lists-${TARGETARCH},target=/var/lib/apt/lists,sharing=locked \
    sed -i \
      -e "s|http://deb.debian.org/debian-security|http://${APT_MIRROR}/debian-security|g" \
      -e "s|http://deb.debian.org/debian|http://${APT_MIRROR}/debian|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked pip3 install --timeout 60 --retries 3 --break-system-packages yt-dlp==2026.7.4 bilibili-cli==0.6.2
COPY --from=build /workspace/deploy ./
COPY --from=build /workspace/apps/worker/dist ./dist
COPY --from=build /workspace/apps/worker/package.json ./package.json
COPY apps/worker/scripts/bilibili-part.py /app/scripts/bilibili-part.py
COPY apps/worker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY scripts/load-container-secrets.mjs /app/load-container-secrets.mjs
ENV NODE_OPTIONS="--import=/app/load-container-secrets.mjs"
USER node
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/worker-main.js"]
