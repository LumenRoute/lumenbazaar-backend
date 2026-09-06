FROM node:24-alpine AS app

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY eslint.config.js .prettierrc.json ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm prisma:generate && pnpm typecheck

ENV NODE_ENV=production

CMD ["pnpm", "start:api"]
