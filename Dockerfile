FROM node:18-bullseye

# Install dependencies untuk canvas dan rendering
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create cache and logs directories with proper permissions
RUN mkdir -p /app/cache/tiles /app/cache/metadata /app/cache/preload /app/logs && \
    chmod -R 755 /app/cache /app/logs

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application files
COPY . .

# Create non-root user for security
RUN groupadd -r osrmuser && useradd -r -g osrmuser osrmuser && \
    chown -R osrmuser:osrmuser /app

# Switch to non-root user
USER osrmuser

# Expose port (configurable via environment variable)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start application with npm start
CMD ["npm", "start"]
