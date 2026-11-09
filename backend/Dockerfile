# ==============================================================================
# Multi-Stage Dockerfile for ChatUK Backend (TypeScript + Express + Socket.IO)
# ==============================================================================
#
# Why Multi-Stage?
# 1. Stage 1 (builder): Installs all dependencies (including devDependencies like TypeScript)
#    and compiles TypeScript (.ts) into optimized JavaScript (.js) inside /app/dist.
# 2. Stage 2 (runner): Starts from a fresh, minimal Node.js Alpine image, installs ONLY
#    production dependencies, copies the compiled JS from Stage 1, and runs as an
#    unprivileged user for maximum security and minimal image size (~150MB vs ~1GB+).
#
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Stage (Compiles TypeScript -> JavaScript)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package manifests first to leverage Docker layer caching.
# Docker caches this step: if package.json and package-lock.json haven't changed,
# Docker will reuse the cached dependencies instead of re-downloading them every build.
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies like TypeScript and @types/*)
RUN npm ci

# Copy TypeScript configuration and source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript (generates /app/dist)
RUN npm run build


# ------------------------------------------------------------------------------
# Stage 2: Production Runner Stage (Lean, Secure & Minimal)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment flag
ENV NODE_ENV=production

# Copy package manifests and install ONLY production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only the compiled JavaScript files from the builder stage
COPY --from=builder /app/dist ./dist

# Security best practice: switch from root to the unprivileged 'node' user
# provided by the official Node.js Alpine base image
USER node

# Document the port that the application listens on (default: 5000)
EXPOSE 5000

# Health check to verify that the HTTP server is alive and responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:5000/ || exit 1

# Start the application using the compiled entrypoint
CMD ["node", "dist/server.js"]

