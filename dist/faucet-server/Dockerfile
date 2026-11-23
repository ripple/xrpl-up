FROM node:20-alpine

WORKDIR /app

# Copy pre-compiled JS (produced by host tsc) and the standalone package.json
COPY server.js .
COPY package.json .

# Install only production dependencies (xrpl)
RUN npm install --omit=dev

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set ownership of app files
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

EXPOSE 3001

CMD ["node", "server.js"]
