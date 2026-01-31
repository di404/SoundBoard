FROM node:18-alpine

WORKDIR /src

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps && \
    rm -rf node_modules/bcrypt

# Copy the rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
