FROM node:20-bookworm-slim AS node-runtime

FROM python:3.12-slim

WORKDIR /app

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/bin/npm /usr/local/bin/npm
COPY --from=node-runtime /usr/local/bin/npx /usr/local/bin/npx
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN pip install --no-cache-dir semgrep

COPY services/rule-engine/app.py ./services/rule-engine/app.py
COPY services/rule-engine/default-semgrep.yml ./services/rule-engine/default-semgrep.yml

ENV RULE_ENGINE_HOST=0.0.0.0
ENV RULE_ENGINE_PORT=58001

CMD ["python", "services/rule-engine/app.py"]
