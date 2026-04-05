# ============================================
# Voltio Backend — Production Dockerfile
# ============================================
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000

CMD ["node", "src/app.js"]
