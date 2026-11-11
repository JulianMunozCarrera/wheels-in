# Build from the repo root:  docker build -f apps/server/Dockerfile .
FROM node:22-alpine
WORKDIR /app

# Copy only the package files first, so Docker can cache the install step.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @wheels-in/server --workspace @wheels-in/core --include-workspace-root

COPY packages/core packages/core
COPY apps/server apps/server

ENV PORT=4000
EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "@wheels-in/server"]
