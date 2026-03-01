#!/bin/bash

# Quick fix for port 8899 issue
# This kills any process using port 8899

echo "🔧 Fixing port 8899 issue..."

# Find and kill process on port 8899
PID=$(lsof -ti:8899 2>/dev/null || echo "")

if [ -z "$PID" ]; then
    echo "✅ Port 8899 is free!"
    exit 0
fi

echo "⚠️  Found process $PID using port 8899"
echo "🔪 Killing process..."

kill -9 $PID 2>/dev/null || true
sleep 1

# Verify
if lsof -ti:8899 >/dev/null 2>&1; then
    echo "❌ Failed to free port 8899"
    echo "Try manually: lsof -ti:8899 | xargs kill -9"
    exit 1
else
    echo "✅ Port 8899 is now free!"
    echo "You can now run: anchor test"
fi
