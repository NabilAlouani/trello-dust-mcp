# Build inside the image so the repo never commits dist/.
FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
