# Seen stream-watcher agent. The KERNEL browser runs in KERNEL's cloud, so this image
# needs no Chromium: playwright-core only speaks CDP to the remote browser.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["npx", "tsx", "src/index.ts"]
