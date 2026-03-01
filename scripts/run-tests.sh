#!/bin/bash

# Run all tests for Collateral Vault Program
# This script runs all test suites and verifies functionality

set -e

echo "🧪 Running Collateral Vault Tests..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Build first
echo -e "${YELLOW}🔨 Building program...${NC}"
anchor build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful!${NC}"

# Run all tests
echo -e "${YELLOW}🧪 Running all test suites...${NC}"
anchor test

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed!${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 Test run complete!${NC}"
