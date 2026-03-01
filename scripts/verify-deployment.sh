#!/bin/bash

# Verify Collateral Vault Program Deployment on Testnet

set -e

echo "🔍 Verifying Collateral Vault Program Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Program ID
PROGRAM_ID="5qgA2qcz6zXYiJJkomV1LJv8UhKueyNsqeCWJd6jC9pT"
RPC_URL="https://api.testnet.solana.com"

# Check if solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Error: Solana CLI not found. Please install Solana CLI first.${NC}"
    exit 1
fi

echo -e "${YELLOW}📡 Checking program on testnet...${NC}"
echo -e "${BLUE}Program ID: ${PROGRAM_ID}${NC}"
echo ""

# Check program
PROGRAM_INFO=$(solana program show "$PROGRAM_ID" --url "$RPC_URL" 2>&1)

if echo "$PROGRAM_INFO" | grep -q "AccountNotFound"; then
    echo -e "${RED}❌ Program not found on testnet!${NC}"
    echo -e "${YELLOW}Please deploy the program first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Program found on testnet!${NC}"
echo ""
echo -e "${BLUE}Program Information:${NC}"
echo "$PROGRAM_INFO" | grep -E "(Program Id|Owner|ProgramData|Authority|Last Deployed|Data Length|Balance)" || echo "$PROGRAM_INFO"

echo ""
echo -e "${GREEN}✅ Deployment Verified!${NC}"
echo ""
echo -e "${YELLOW}📊 Quick Stats:${NC}"

# Extract key information
OWNER=$(echo "$PROGRAM_INFO" | grep "Owner:" | awk '{print $2}' || echo "N/A")
AUTHORITY=$(echo "$PROGRAM_INFO" | grep "Authority:" | awk '{print $2}' || echo "N/A")
BALANCE=$(echo "$PROGRAM_INFO" | grep "Balance:" | awk '{print $2, $3}' || echo "N/A")
DATA_LENGTH=$(echo "$PROGRAM_INFO" | grep "Data Length:" | awk '{print $3}' || echo "N/A")

echo -e "  Owner: ${OWNER}"
echo -e "  Authority: ${AUTHORITY}"
echo -e "  Balance: ${BALANCE}"
echo -e "  Data Length: ${DATA_LENGTH} bytes"

echo ""
echo -e "${GREEN}🌐 View on Explorer:${NC}"
echo -e "  https://explorer.solana.com/address/${PROGRAM_ID}?cluster=testnet"
echo ""

# Check if program is upgradeable
if echo "$PROGRAM_INFO" | grep -q "BPFLoaderUpgradeab1e11111111111111111111111"; then
    echo -e "${GREEN}✅ Program is upgradeable${NC}"
else
    echo -e "${YELLOW}⚠️  Program may not be upgradeable${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Verification Complete!${NC}"
