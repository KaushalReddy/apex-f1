FROM node:22-alpine AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Bundled results and telemetry: pages are refreshed at runtime (ISR), and read these when DATA_DIR has no newer copy.
COPY --from=build /app/src/data ./src/data
# Synced data (tools/openf1-sync) is mounted here from a persistent volume shared with the sync worker; see docs/DATA_PIPELINE.md.
ENV DATA_DIR=/data
# Page refreshes (ISR) write their cache under .next: owned by the unprivileged user that runs the server.
RUN mkdir -p /data && chown node:node /data && chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["node", "server.js"]
