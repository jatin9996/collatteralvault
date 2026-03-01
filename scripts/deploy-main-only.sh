#!/bin/bash

# Deploy only the main Collateral Vault Program to Solana Testnet
# This script skips the mock program to avoid IDL issues

set -e

echo "🚀 Starting deployment to Solana Testnet (Main Program Only)..."

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

# Check if solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Error: Solana CLI not found. Please install Solana CLI first.${NC}"
    exit 1
fi

# Set cluster to testnet
echo -e "${YELLOW}📡 Setting cluster to testnet...${NC}"
solana config set --url https://api.testnet.solana.com

# Check wallet
WALLET_ADDRESS=$(solana address)
echo -e "${GREEN}✓ Wallet address: ${WALLET_ADDRESS}${NC}"

# Check balance (fixed parsing)
BALANCE_RAW=$(solana balance --lamports 2>/dev/null | grep -oE '[0-9]+' | head -1)
BALANCE=${BALANCE_RAW:-0}
echo -e "${YELLOW}💰 Current balance: ${BALANCE} lamports${NC}"

# Check if balance is sufficient (need at least 2 SOL for deployment)
MIN_BALANCE=2000000000  # 2 SOL in lamports
if [ "$BALANCE" -lt "$MIN_BALANCE" ]; then
    echo -e "${YELLOW}⚠️  Balance is low. Requesting airdrop...${NC}"
    solana airdrop 2 || echo -e "${YELLOW}⚠️  Airdrop failed (rate limit). Continuing anyway...${NC}"
    sleep 5
    BALANCE_RAW=$(solana balance --lamports 2>/dev/null | grep -oE '[0-9]+' | head -1)
    BALANCE=${BALANCE_RAW:-0}
    echo -e "${GREEN}✓ New balance: ${BALANCE} lamports${NC}"
fi

# Build the program
echo -e "${YELLOW}🔨 Building program...${NC}"
anchor build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful!${NC}"

# Get program ID from Anchor.toml
PROGRAM_ID=$(grep -A 1 "\[programs.testnet\]" Anchor.toml | grep "collateral_vault" | cut -d '"' -f 2)

if [ -z "$PROGRAM_ID" ]; then
    echo -e "${RED}❌ Error: Could not find program ID in Anchor.toml${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Program ID: ${PROGRAM_ID}${NC}"

# Deploy only the main program (skip mock)
echo -e "${YELLOW}🚀 Deploying collateral_vault to testnet...${NC}"
solana program deploy \
  target/deploy/collateral_vault.so \
  --program-id target/deploy/collateral_vault-keypair.json \
  --url https://api.testnet.solana.com \
  --max-len 0

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Deployment successful!${NC}"

# Verify deployment
echo -e "${YELLOW}🔍 Verifying deployment...${NC}"
solana program show "$PROGRAM_ID" --url https://api.testnet.solana.com

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Program deployed and verified on testnet!${NC}"
    echo -e "${GREEN}📍 Program ID: ${PROGRAM_ID}${NC}"
    echo -e "${GREEN}🌐 View on Explorer: https://explorer.solana.com/address/${PROGRAM_ID}?cluster=testnet${NC}"
    echo -e "${YELLOW}ℹ️  Note: IDL upload can be done separately if needed using: anchor idl init${NC}"
else
    echo -e "${RED}❌ Verification failed!${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"
