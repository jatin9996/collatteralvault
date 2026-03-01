#!/bin/bash

# Run End-to-End Demo Test with Sample Data
# This demonstrates the complete collateral vault lifecycle

set -e

echo "🧪 Running End-to-End Demo Test..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "Anchor.toml" ]; then
    echo -e "${RED}❌ Error: Anchor.toml not found. Please run this script from the project root.${NC}"
    exit 1
fi

# Check if anchor is installed
if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Error: Anchor CLI not found. Please install Anchor first.${NC}"
    exit 1
fi

# Kill any existing validator on port 8899
echo -e "${YELLOW}🔍 Checking for existing validator...${NC}"
if lsof -ti:8899 >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port 8899 is in use. Killing existing process...${NC}"
    lsof -ti:8899 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Build first
echo -e "${YELLOW}🔨 Building programs...${NC}"
anchor build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful!${NC}"

# Run the E2E demo test
echo -e "${BLUE}🚀 Starting End-to-End Demo Test...${NC}"
echo -e "${YELLOW}This will demonstrate:${NC}"
echo -e "  • Initialize Vault Authority"
echo -e "  • Initialize User Vaults"
echo -e "  • Deposit Collateral"
echo -e "  • Lock Collateral (via CPI)"
echo -e "  • Unlock Collateral (via CPI)"
echo -e "  • Withdraw Collateral"
echo -e "  • Transfer Between Vaults"
echo ""

anchor test tests/e2e-demo.spec.ts

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ End-to-End Demo Completed Successfully!${NC}"
    echo -e "${GREEN}📊 Check the output above for detailed state information${NC}"
else
    echo -e "${RED}❌ Demo test failed!${NC}"
    exit 1
fi
