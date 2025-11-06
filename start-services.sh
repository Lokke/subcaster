#!/bin/sh

# Start services script for Docker container

echo "Starting SubCaster unified server..."

# Create .env file from environment variables if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from environment variables..."
    {
        echo "VITE_STREAM_USERNAME=${STREAM_USERNAME:-test}"
        echo "VITE_STREAM_PASSWORD=${STREAM_PASSWORD:-test}"
        echo "VITE_STREAM_SERVER=${STREAM_SERVER:-funkturm.radio-endstation.de}"
        echo "VITE_STREAM_PORT=${STREAM_PORT:-8015}"
        echo "VITE_STREAM_MOUNT=${STREAM_MOUNT:-/}"
    } > .env 2>/dev/null || echo "Warning: Could not create .env file, using environment variables directly"
fi

# Start unified server (Web + CORS Proxy + Harbor Stream)
echo "Starting unified server on port 5173..."
node unified-server.js &
SERVER_PID=$!

# Function to handle shutdown
shutdown() {
    echo "Shutting down unified server..."
    kill $SERVER_PID 2>/dev/null
    exit 0
}

# Trap signals
trap shutdown SIGTERM SIGINT

# Wait for server process
wait $SERVER_PID
