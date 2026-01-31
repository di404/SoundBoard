FROM node:22-alpine

WORKDIR /src

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with explicit npm version
RUN npm install -g npm@11.8.0 && \
    npm install --legacy-peer-deps --no-audit --no-fund

# Copy the rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
