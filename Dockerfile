FROM node:22-alpine

WORKDIR /src

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy the rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
