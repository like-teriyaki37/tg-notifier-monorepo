# Notifier Worker Dockerfile
FROM node:20-alpine
WORKDIR /app

# Copy entire monorepo (kept lean by .dockerignore)
COPY . .

# Install deps and build all workspaces
RUN npm install && npm run build

ENV NODE_ENV=development
CMD ["node", "packages/notifier-worker/dist/index.js"]
