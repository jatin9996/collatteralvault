#!/bin/bash

# Start Solana Validator in Background
# This starts a validator that runs in the background

set -e

echo "🚀 Starting Solana Validator in Background..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if solana CLI is installed
if ! command -v solana-test-validator &> /dev/null; then
    echo -e "${RED}❌ Error: solana-test-validator not found.${NC}"
    exit 1
fi

# Check if port 8899 is already in use
if lsof -ti:8899 >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port 8899 is already in use.${NC}"
    echo -e "${YELLOW}Killing existing process...${NC}"
    lsof -ti:8899 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Create logs directory if it doesn't exist
mkdir -p test-ledger

echo -e "${BLUE}Starting Solana test validator in background...${NC}"

# Start validator in background and save PID
nohup solana-test-validator \
    --reset \
    --quiet \
    --limit-ledger-size 50000000 \
    > test-ledger/validator.log 2>&1 &

VALIDATOR_PID=$!

# Wait a moment for validator to start
sleep 3

# Check if validator is running
if ps -p $VALIDATOR_PID > /dev/null; then
    echo -e "${GREEN}✅ Validator started successfully!${NC}"
    echo -e "${BLUE}Validator PID: ${VALIDATOR_PID}${NC}"
    echo -e "${BLUE}RPC: http://127.0.0.1:8899${NC}"
    echo -e "${BLUE}WebSocket: ws://127.0.0.1:8900${NC}"
    echo -e "${BLUE}Faucet: http://127.0.0.1:9900${NC}"
    echo ""
    echo -e "${YELLOW}To stop the validator:${NC}"
    echo -e "  kill $VALIDATOR_PID"
    echo -e "  or"
    echo -e "  ./scripts/stop-validator.sh"
    echo ""
    echo -e "${YELLOW}To view logs:${NC}"
    echo -e "  tail -f test-ledger/validator.log"
    echo ""
    echo -e "${GREEN}Validator is ready for testing!${NC}"
else
    echo -e "${RED}❌ Validator failed to start. Check logs:${NC}"
    echo -e "  tail test-ledger/validator.log"
    exit 1
fi
