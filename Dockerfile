FROM node:18-alpine

# Install lightweight utilities (curl/wget for healthcheck)
RUN apk add --no-cache curl wget

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application files
COPY src ./src
COPY public ./public

# Expose port (configurable via environment variable, default 81)
EXPOSE 81

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:81/health || exit 1

# Start application
CMD ["npm", "start"]
