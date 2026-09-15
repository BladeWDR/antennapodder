FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set environment
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source and public static assets
COPY src/ ./src/
COPY public/ ./public/

# Create persistent data directory and grant permissions to node user
RUN mkdir -p /data && chown -R node:node /app /data

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e 'require("node:http").get("http://localhost:" + (process.env.PORT || 3000) + "/api/auth/me", (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on("error", () => process.exit(1))'

# Run server
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
