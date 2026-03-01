#!/bin/bash

# Safe test script that ensures port 8899 is free before running tests

set -e

echo "🧪 Running Anchor tests (with port cleanup)..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Step 1: Kill any processes on port 8899
echo -e "${YELLOW}🔍 Ensuring port 8899 is free...${NC}"

# Kill solana-test-validator processes
pkill -9 -f "solana-test-validator" 2>/dev/null || true
killall -9 solana-test-validator 2>/dev/null || true

# Kill processes on port 8899
if command -v lsof &> /dev/null; then
    PIDS=$(lsof -ti:8899 2>/dev/null || echo "")
    if [ -n "$PIDS" ]; then
        echo -e "${YELLOW}Killing processes on port 8899: $PIDS${NC}"
        for PID in $PIDS; do
            kill -9 $PID 2>/dev/null || true
        done
        sleep 1
    fi
fi

# Use fuser if available
if command -v fuser &> /dev/null; then
    fuser -k 8899/tcp 2>/dev/null || true
    sleep 1
fi

# Final check
if command -v lsof &> /dev/null; then
    if lsof -ti:8899 >/dev/null 2>&1; then
        echo -e "${RED}❌ Port 8899 is still in use. Please free it manually.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Port 8899 is free${NC}"

# Step 2: Run anchor test
echo -e "${YELLOW}🚀 Running anchor test...${NC}"
echo ""

# Run anchor test
anchor test "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Tests completed successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Tests failed with exit code $EXIT_CODE${NC}"
fi

exit $EXIT_CODE
