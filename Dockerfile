FROM node:22-alpine

# Install su-exec to safely drop root privileges after fixing mounted volume permissions
RUN apk add --no-cache su-exec

# Set working directory
WORKDIR /app

# Set environment
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    PUID=1000 \
    PGID=1000

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source, public static assets, and entrypoint
COPY src/ ./src/
COPY public/ ./public/
COPY entrypoint.sh ./entrypoint.sh

# Ensure executable entrypoint and fallback data directory
RUN chmod +x ./entrypoint.sh && \
    mkdir -p /data && \
    chown -R node:node /app /data

# Expose port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e 'require("node:http").get("http://localhost:" + (process.env.PORT || 3000) + "/api/auth/me", (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on("error", () => process.exit(1))'

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
