# OpenF1 sync worker (tools/openf1-sync): keeps the shared DATA_DIR volume up to date with new races, telemetry and season results.
# Historical data only (no OpenF1 account). It needs the website's bundled indexes to skip races the site already ships.
FROM node:22-alpine
WORKDIR /app
COPY tools/openf1-client.mjs tools/openf1-client.mjs
COPY tools/openf1-replay/export.mjs tools/openf1-replay/export.mjs
COPY tools/openf1-results/export.mjs tools/openf1-results/export.mjs
COPY tools/openf1-telemetry/export.mjs tools/openf1-telemetry/export.mjs
COPY tools/openf1-sync/core.mjs tools/openf1-sync/plan.mjs tools/openf1-sync/sync.mjs tools/openf1-sync/
COPY apps/web/public/replay/ /bundled/replay/
COPY apps/web/src/data/telemetry/ /bundled/telemetry/
# Only the bundled indexes are needed (not the multi-megabyte race files).
RUN find /bundled -type f ! -name index.json -delete
ENV NODE_ENV=production DATA_DIR=/data APEX_BUNDLED_REPLAY_DIR=/bundled/replay APEX_BUNDLED_TELEMETRY_DIR=/bundled/telemetry
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "tools/openf1-sync/sync.mjs", "--watch"]
