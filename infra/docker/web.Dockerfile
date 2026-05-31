FROM node:20-bookworm-slim AS build

WORKDIR /app

ENV HTTP_PROXY=
ENV HTTPS_PROXY=
ENV ALL_PROXY=
ENV http_proxy=
ENV https_proxy=
ENV all_proxy=
ENV NPM_CONFIG_PROXY=
ENV NPM_CONFIG_HTTPS_PROXY=
ENV npm_config_proxy=
ENV npm_config_https_proxy=

COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN npm config set proxy "" \
  && npm config set https-proxy "" \
  && npm config set registry "https://registry.npmmirror.com"
RUN npm install
RUN arch="$(uname -m)" \
  && if [ "$arch" = "x86_64" ] || [ "$arch" = "amd64" ]; then npm install @rolldown/binding-linux-x64-gnu lightningcss-linux-x64-gnu --no-save; \
  elif [ "$arch" = "aarch64" ] || [ "$arch" = "arm64" ]; then npm install @rolldown/binding-linux-arm64-gnu lightningcss-linux-arm64-gnu --no-save; \
  else echo "unsupported architecture: $arch" >&2; exit 1; fi
RUN npm run build --workspace=@ai-pr-review/web

FROM nginx:1.27-alpine

COPY infra/docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
