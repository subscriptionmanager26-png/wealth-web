FROM node:20-slim AS build
WORKDIR /repo
# Build context should be pdf-parser/ (parent of wealth-web + mobile-app)
COPY mobile-app ./mobile-app
COPY wealth-web ./wealth-web
WORKDIR /repo/wealth-web
RUN npm ci && npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /repo/wealth-web/dist ./dist
COPY --from=build /repo/wealth-web/server ./server
COPY --from=build /repo/wealth-web/package.json ./
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server/proxy.mjs"]
