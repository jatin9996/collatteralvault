#!/bin/bash

# Test script that ensures clean state before running tests

set -e

cd "$(dirname "$0")/.."

echo "🧹 Cleaning up before tests..."

# Kill any existing validators
./scripts/kill-validator.sh

# Clean test ledger
if [ -d "test-ledger" ]; then
    rm -rf test-ledger
    echo "✓ Test ledger cleaned"
fi

# Wait a moment for ports to be released
sleep 2

echo "🧪 Running anchor test..."
echo ""

# Run anchor test - it will start its own validator
anchor test "$@"
