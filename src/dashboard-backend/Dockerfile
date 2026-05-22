# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

# Install docker CLI for docker exec access to Wazuh container
RUN apk add --no-cache docker-cli

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
