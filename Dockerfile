# syntax=docker/dockerfile:1
# 此刻三张牌 —— 自托管镜像。密钥不进镜像：ANTHROPIC_API_KEY 只在 `docker run` / compose 时通过环境变量传入。

ARG NODE_IMAGE=node:22-alpine

# ---- 依赖 ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---- 构建 ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# standalone 输出：运行时不需要 node_modules
ENV TAROT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- 运行 ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# 容器里必须监听 0.0.0.0 才能被端口映射访问；对外暴露范围由 `-p 127.0.0.1:3000:3000` 决定（见 README / compose）
ENV HOSTNAME=0.0.0.0
RUN addgroup -S tarot && adduser -S tarot -G tarot
COPY --from=build --chown=tarot:tarot /app/.next/standalone ./
COPY --from=build --chown=tarot:tarot /app/.next/static ./.next/static
COPY --from=build --chown=tarot:tarot /app/public ./public
# prompt 与内容文件在运行时按路径读取（standalone 追踪不到），显式带上
COPY --from=build --chown=tarot:tarot /app/content ./content
USER tarot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
