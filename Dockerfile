FROM node:22

# Install ts-node globally
RUN npm install -g tsx typescript

# Set working directory
WORKDIR /app
# Copy package files if you want to pre-install deps
# COPY package*.json ./
COPY *.ts /app/
COPY package*.json /app/

RUN chmod 755 *.ts
RUN npm install
# RUN npm audit fix --force
