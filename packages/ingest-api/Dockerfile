# Ingest API Dockerfile
FROM node:20-alpine
WORKDIR /app

# Copy entire monorepo (kept lean by .dockerignore)
COPY . .

# Install deps and build all workspaces
RUN npm install && npm run build

ENV NODE_ENV=development
ENV PORT=3000
EXPOSE 3000
CMD ["node", "packages/ingest-api/dist/index.js"]
