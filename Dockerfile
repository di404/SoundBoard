FROM node:22-alpine

WORKDIR /src

# Copy package files first for better caching
COPY package*.json ./

# Update npm first
RUN npm update -g npm

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
