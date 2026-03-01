#!/bin/bash

# Complete restart script: Clean everything and start fresh validator on port 8899

set -e

echo "🔄 Complete Restart: Cleaning and Starting Fresh Validator..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Step 1: Kill all Solana validators and processes on port 8899
echo -e "${YELLOW}🧹 Step 1: Cleaning up existing processes...${NC}"

# Kill all solana-test-validator processes
echo -e "${BLUE}Killing solana-test-validator processes...${NC}"
pkill -9 -f "solana-test-validator" 2>/dev/null || true
killall -9 solana-test-validator 2>/dev/null || true
sleep 1

# Kill processes on port 8899 using multiple methods
if command -v lsof &> /dev/null; then
    PIDS=$(lsof -ti:8899 2>/dev/null || echo "")
    if [ -n "$PIDS" ]; then
        echo -e "${BLUE}Killing processes on port 8899: $PIDS${NC}"
        for PID in $PIDS; do
            kill -9 $PID 2>/dev/null || true
        done
        sleep 1
    fi
fi

# Use fuser if available
if command -v fuser &> /dev/null; then
    echo -e "${BLUE}Using fuser to free port 8899...${NC}"
    fuser -k 8899/tcp 2>/dev/null || true
    sleep 1
fi

# Wait a bit to ensure ports are released
sleep 2

# Verify port is free
if command -v lsof &> /dev/null; then
    if lsof -ti:8899 >/dev/null 2>&1; then
        echo -e "${RED}❌ Port 8899 is still in use. Trying one more time...${NC}"
        lsof -ti:8899 | xargs kill -9 2>/dev/null || true
        sleep 2
    fi
fi

echo -e "${GREEN}✓ Cleanup complete${NC}"

# Step 2: Clean test ledger if it exists
echo -e "${YELLOW}🧹 Step 2: Cleaning test ledger...${NC}"
if [ -d "test-ledger" ]; then
    echo -e "${BLUE}Removing test-ledger directory...${NC}"
    rm -rf test-ledger
    echo -e "${GREEN}✓ Test ledger cleaned${NC}"
else
    echo -e "${GREEN}✓ No test ledger to clean${NC}"
fi

# Step 3: Check if solana CLI is installed
echo -e "${YELLOW}🔍 Step 3: Checking Solana installation...${NC}"
if ! command -v solana-test-validator &> /dev/null; then
    echo -e "${RED}❌ Error: solana-test-validator not found.${NC}"
    echo -e "${YELLOW}Please install Solana CLI:${NC}"
    echo -e "  sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

SOLANA_VERSION=$(solana-test-validator --version 2>/dev/null || echo "unknown")
echo -e "${GREEN}✓ Solana test validator found: $SOLANA_VERSION${NC}"

# Step 4: Start fresh validator on port 8899
echo -e "${YELLOW}🚀 Step 4: Starting fresh validator on port 8899...${NC}"
echo ""
echo -e "${BLUE}Validator will start on:${NC}"
echo -e "  ${GREEN}RPC:${NC}      http://127.0.0.1:8899"
echo -e "  ${GREEN}WebSocket:${NC} ws://127.0.0.1:8900"
echo -e "  ${GREEN}Faucet:${NC}    http://127.0.0.1:9900"
echo ""

# Create logs directory
mkdir -p test-ledger

# Start validator in background
echo -e "${BLUE}Starting validator...${NC}"
nohup solana-test-validator \
    --reset \
    --quiet \
    --limit-ledger-size 50000000 \
    > test-ledger/validator.log 2>&1 &

VALIDATOR_PID=$!

# Wait for validator to start
echo -e "${YELLOW}Waiting for validator to start (this may take a few seconds)...${NC}"
sleep 5

# Check if validator is running
if ps -p $VALIDATOR_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Validator process is running (PID: $VALIDATOR_PID)${NC}"
    
    # Wait a bit more and check if RPC is responding
    sleep 3
    
    if curl -s http://127.0.0.1:8899/health >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Validator is ready and responding!${NC}"
        echo ""
        echo -e "${BLUE}Validator Information:${NC}"
        echo -e "  ${GREEN}PID:${NC}     $VALIDATOR_PID"
        echo -e "  ${GREEN}RPC:${NC}     http://127.0.0.1:8899"
        echo -e "  ${GREEN}Logs:${NC}    test-ledger/validator.log"
        echo ""
        echo -e "${YELLOW}To stop the validator:${NC}"
        echo -e "  kill $VALIDATOR_PID"
        echo -e "  or"
        echo -e "  ./scripts/stop-validator.sh"
        echo ""
        echo -e "${GREEN}✅ Validator restarted successfully on port 8899!${NC}"
    else
        echo -e "${YELLOW}⚠️  Validator started but RPC not responding yet.${NC}"
        echo -e "${YELLOW}   It may need a few more seconds to fully start.${NC}"
        echo -e "${YELLOW}   Check logs: tail -f test-ledger/validator.log${NC}"
        echo -e "${GREEN}✓ Validator process is running (PID: $VALIDATOR_PID)${NC}"
    fi
else
    echo -e "${RED}❌ Validator failed to start.${NC}"
    echo -e "${YELLOW}Check logs:${NC}"
    tail -20 test-ledger/validator.log 2>/dev/null || echo "No logs available"
    exit 1
fi
