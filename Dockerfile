FROM ghcr.io/openai/tunnel-client:v0.0.14@sha256:41d7c85dab37797a3eaa17c41b94a7206dd0bc186fd361034c9ec3863596ff6c AS tunnel-client

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY server ./server
COPY shared ./shared
COPY web ./web
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
COPY --from=tunnel-client /usr/bin/tunnel-client /usr/local/bin/tunnel-client
COPY --from=tunnel-client /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --chown=node:node package.json package-lock.json ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "Promise.all(['http://127.0.0.1:3001/api/health',...(process.env.ENABLE_MCP==='true'?['http://127.0.0.1:'+(process.env.MCP_PORT||3002)+'/health']:[])].map(u=>fetch(u))).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
