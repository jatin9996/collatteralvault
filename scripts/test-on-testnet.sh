#!/bin/bash

# Run tests against testnet (without starting local validator)

set -e

echo "🧪 Running tests against Solana Testnet..."

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

# Set cluster to testnet
echo -e "${YELLOW}📡 Setting cluster to testnet...${NC}"
solana config set --url https://api.testnet.solana.com

# Check wallet
WALLET_ADDRESS=$(solana address)
echo -e "${GREEN}✓ Wallet address: ${WALLET_ADDRESS}${NC}"

# Build first
echo -e "${YELLOW}🔨 Building programs...${NC}"
anchor build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful!${NC}"

# Deploy to testnet first (if needed)
echo -e "${YELLOW}🚀 Deploying to testnet...${NC}"
anchor deploy --provider.cluster testnet 2>&1 | grep -v "Error creating IDL account" || true

# Run tests with skip_local_validator flag
echo -e "${YELLOW}🧪 Running tests against testnet...${NC}"
echo -e "${YELLOW}ℹ️  Note: Tests will run against the deployed testnet program${NC}"
echo ""

# Use anchor test but skip local validator
ANCHOR_TEST_ARGS="--skip-local-validator --provider.cluster testnet"

# Check if skip-local-validator is supported (it might not be in all Anchor versions)
if anchor test --help 2>&1 | grep -q "skip-local-validator"; then
    anchor test $ANCHOR_TEST_ARGS
else
    # Alternative: Update Anchor.toml temporarily
    echo -e "${YELLOW}⚠️  skip-local-validator not available, using alternative method...${NC}"
    
    # Create a temporary Anchor.toml with skip_local_validator
    cp Anchor.toml Anchor.toml.backup
    
    # Add skip_local_validator to test section if not present
    if ! grep -q "skip_local_validator" Anchor.toml; then
        sed -i '/\[test\]/a skip_local_validator = true' Anchor.toml
    fi
    
    # Run tests
    anchor test --provider.cluster testnet || {
        # Restore backup on failure
        mv Anchor.toml.backup Anchor.toml
        exit 1
    }
    
    # Restore backup
    mv Anchor.toml.backup Anchor.toml
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Tests completed!${NC}"
else
    echo -e "${RED}❌ Tests failed!${NC}"
    exit 1
fi
