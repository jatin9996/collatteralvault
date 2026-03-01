#!/bin/bash

# Start Solana Validator for Local Testing
# This starts a local validator that Anchor can use for testing

set -e

echo "🚀 Starting Solana Validator for Local Testing..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if solana CLI is installed
if ! command -v solana-test-validator &> /dev/null; then
    echo -e "${RED}❌ Error: solana-test-validator not found.${NC}"
    echo -e "${YELLOW}Please install Solana CLI:${NC}"
    echo -e "  sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

# Check if port 8899 is already in use
if lsof -ti:8899 >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port 8899 is already in use.${NC}"
    echo -e "${YELLOW}Killing existing process...${NC}"
    lsof -ti:8899 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Check if we're in the right directory
if [ ! -f "Anchor.toml" ]; then
    echo -e "${YELLOW}⚠️  Anchor.toml not found. Starting validator anyway...${NC}"
fi

echo -e "${BLUE}Starting Solana test validator...${NC}"
echo -e "${YELLOW}This will start a local validator on:${NC}"
echo -e "  RPC: http://127.0.0.1:8899"
echo -e "  WebSocket: ws://127.0.0.1:8900"
echo -e "  Faucet: http://127.0.0.1:9900"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the validator${NC}"
echo ""

# Start the validator
# Options:
#   --reset: Clear ledger on startup
#   --quiet: Less verbose output
#   --limit-ledger-size: Limit ledger size
solana-test-validator \
    --reset \
    --quiet \
    --limit-ledger-size 50000000
