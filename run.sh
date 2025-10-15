#!/bin/bash

# Step 1: Find the process using port 3000
PID=$(lsof -t -i:3000)

if [ -n "$PID" ]; then
  echo "Killing process running on port 3000 (PID: $PID)..."
  kill -9 $PID
else
  echo "No process found running on port 3000."
fi

# Step 2: Start the development server
echo "Starting development server..."
npm run dev
