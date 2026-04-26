FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS production

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

COPY package.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist

USER nodejs

EXPOSE 8080

CMD ["node", "dist/index.js"]
