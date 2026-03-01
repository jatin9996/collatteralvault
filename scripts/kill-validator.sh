#!/bin/bash

# Kill any Solana validator running on port 8899
# This script uses multiple methods to ensure the port is freed

set -e

echo "🔍 Checking for processes on port 8899..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Method 1: Kill solana-test-validator processes
echo -e "${YELLOW}Checking for solana-test-validator processes...${NC}"
pkill -9 -f "solana-test-validator" 2>/dev/null || true
killall -9 solana-test-validator 2>/dev/null || true

# Method 2: Find and kill process using port 8899 (lsof)
if command -v lsof &> /dev/null; then
    PIDS=$(lsof -ti:8899 2>/dev/null || echo "")
    if [ -n "$PIDS" ]; then
        echo -e "${YELLOW}⚠️  Found process(es) using port 8899: $PIDS${NC}"
        for PID in $PIDS; do
            echo -e "${YELLOW}Killing process $PID...${NC}"
            kill -9 $PID 2>/dev/null || true
        done
        sleep 1
    fi
fi

# Method 3: Use fuser if available
if command -v fuser &> /dev/null; then
    echo -e "${YELLOW}Using fuser to free port 8899...${NC}"
    fuser -k 8899/tcp 2>/dev/null || true
    sleep 1
fi

# Method 4: Use netstat/ss to find and kill
if command -v ss &> /dev/null; then
    PIDS=$(ss -tlnp 2>/dev/null | grep :8899 | grep -oP 'pid=\K[0-9]+' | sort -u || echo "")
    if [ -n "$PIDS" ]; then
        echo -e "${YELLOW}Found additional processes via ss: $PIDS${NC}"
        for PID in $PIDS; do
            kill -9 $PID 2>/dev/null || true
        done
        sleep 1
    fi
fi

# Final verification
FOUND=false
if command -v lsof &> /dev/null; then
    if lsof -ti:8899 >/dev/null 2>&1; then
        FOUND=true
    fi
elif command -v ss &> /dev/null; then
    if ss -tlnp 2>/dev/null | grep -q :8899; then
        FOUND=true
    fi
fi

if [ "$FOUND" = true ]; then
    echo -e "${RED}❌ Port 8899 is still in use${NC}"
    echo -e "${YELLOW}Try manually:${NC}"
    echo -e "  lsof -ti:8899 | xargs kill -9"
    echo -e "  or"
    echo -e "  fuser -k 8899/tcp"
    exit 1
else
    echo -e "${GREEN}✓ Port 8899 is now free${NC}"
    exit 0
fi
