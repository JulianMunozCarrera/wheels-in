# Build from the repo root:  docker build -f apps/web/Dockerfile .
# Step 1: build the site into plain files.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
# The browser needs to know where the server is. This gets baked into the files.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# Step 2: serve those files with nginx. No Node needed at run time.
FROM nginx:alpine
COPY --from=build /app/apps/web/out /usr/share/nginx/html
EXPOSE 80
