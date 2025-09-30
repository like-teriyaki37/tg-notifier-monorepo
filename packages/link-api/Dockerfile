# Link API Dockerfile
FROM node:20-alpine
WORKDIR /app

# Copy entire monorepo (kept lean by .dockerignore)
COPY . .

# Install deps and build all workspaces
RUN npm install && npm run build

ENV NODE_ENV=development
ENV PORT=3001
EXPOSE 3001
CMD ["node", "packages/link-api/dist/index.js"]
