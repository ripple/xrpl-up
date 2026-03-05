FROM node:20-alpine

WORKDIR /app

# Copy pre-compiled JS (produced by host tsc) and the standalone package.json
COPY server.js .
COPY package.json .

# Install only production dependencies (xrpl)
RUN npm install --omit=dev

EXPOSE 3001

CMD ["node", "server.js"]
