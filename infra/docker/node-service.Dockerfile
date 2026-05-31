FROM node:20-bookworm-slim

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

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN npm config set proxy "" \
  && npm config set https-proxy "" \
  && npm config set registry "https://registry.npmmirror.com"
RUN npm install

ARG SERVICE_PATH
ARG TSCONFIG_PATH=tsconfig.json
ENV SERVICE_PATH=${SERVICE_PATH}
ENV TSCONFIG_PATH=${TSCONFIG_PATH}
ENV NODE_ENV=production

CMD ["sh", "-lc", "node_modules/.bin/tsx --tsconfig ${TSCONFIG_PATH} ${SERVICE_PATH}"]
