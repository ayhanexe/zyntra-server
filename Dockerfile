# Multi-stage production build for Zyntra Server with Python & yt-dlp
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package manifests and configs
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* tsconfig.json ./

# Install dependencies (ignoring native build scripts in build step)
RUN pnpm install --ignore-scripts

# Copy source code
COPY src ./src

# Build TypeScript to dist
RUN pnpm build

# --- Production Runner Stage ---
FROM node:22-alpine AS runner

WORKDIR /app

# Install runtime dependencies: Python3, ffmpeg, curl (for yt-dlp)
RUN apk add --no-cache python3 py3-pip ffmpeg curl bash

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install pnpm
RUN npm install -g pnpm

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy package manifests
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install production dependencies only
RUN pnpm install --prod --ignore-scripts

# Copy built code from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
