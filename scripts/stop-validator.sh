#!/bin/bash

# Stop Solana Validator
# This stops any running Solana test validator

set -e

echo "🛑 Stopping Solana Validator..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Find processes using port 8899 (validator RPC)
PIDS=$(lsof -ti:8899 2>/dev/null || echo "")

if [ -z "$PIDS" ]; then
    echo -e "${GREEN}✅ No validator running on port 8899${NC}"
    exit 0
fi

echo -e "${YELLOW}Found validator process(es): $PIDS${NC}"

# Kill all processes
for PID in $PIDS; do
    echo -e "${YELLOW}Killing process $PID...${NC}"
    kill -9 $PID 2>/dev/null || true
done

sleep 1

# Verify
if lsof -ti:8899 >/dev/null 2>&1; then
    echo -e "${RED}❌ Failed to stop validator${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Validator stopped successfully${NC}"
fi
