# Build stage - compile native modules
FROM node:18-alpine AS builder

WORKDIR /app

# sqlite3 requires build tools
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# Production stage - minimal image
FROM node:18-alpine

WORKDIR /app

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY public/ ./public/

# Create directories (permissions handled by docker-compose user)
RUN mkdir -p /app/data /app/config /app/logs && chmod -R 777 /app/data /app/config /app/logs

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
