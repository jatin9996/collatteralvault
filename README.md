# Collateral Vault - Solana Smart Contract

A secure, production-ready Solana smart contract for managing collateral deposits, withdrawals, and yield generation for USDT tokens.

## Overview

The Collateral Vault program provides a comprehensive solution for:
- **Collateral Management**: Secure deposit and withdrawal of USDT tokens
- **Position Management**: Lock/unlock collateral for trading positions
- **Yield Generation**: Integration with yield protocols (Marginfi, Solend)
- **Security Features**: Multisig support, timelocks, rate limiting, whitelists
- **Access Control**: Delegation, CPI enforcement, governance controls

## Features

- ✅ **Secure Deposits & Withdrawals**: SPL Token integration with comprehensive validation
- ✅ **Multisig Support**: Configurable multi-signature wallets for enhanced security
- ✅ **Timelocks**: Scheduled unlocks and minimum withdrawal delays
- ✅ **Rate Limiting**: Per-vault withdrawal limits and time windows
- ✅ **Yield Integration**: Support for multiple yield protocols with auto-compounding
- ✅ **CPI Support**: Cross-program invocation for position management
- ✅ **Delegation**: Authorized delegates for vault operations
- ✅ **Emergency Controls**: Freeze mechanism and emergency withdrawals

## Quick Start

### Prerequisites

- **Rust**: Latest stable version
- **Solana CLI**: 1.18+
- **Anchor**: 0.32.1
- **Node.js**: 18+
- **Yarn**: Package manager

### Installation

```bash
# Install dependencies
yarn install

# Build the program
anchor build

# Run tests
anchor test
```

### Deployment

```bash
# Deploy to testnet
./scripts/deploy-testnet.sh

# Or manually
anchor deploy --provider.cluster testnet
```

## Project Structure

```
collateral-vault/
├── programs/
│   ├── collateral-vault/      # Main program
│   │   ├── src/
│   │   │   ├── lib.rs        # Program entry point
│   │   │   ├── instructions/ # Instruction handlers
│   │   │   ├── state/        # Account state definitions
│   │   │   ├── error.rs       # Error definitions
│   │   │   ├── events.rs      # Event definitions
│   │   │   └── constants.rs  # Constants
│   │   └── Cargo.toml
│   └── mock-position-manager/ # Mock program for testing
├── tests/                     # Integration tests
├── scripts/                   # Deployment and utility scripts
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT_GUIDE.md
│   ├── SPL_TOKEN_INTEGRATION.md
│   └── SECURITY_ANALYSIS.md
└── Anchor.toml                 # Anchor configuration
```

## Documentation

- **[Architecture](./docs/ARCHITECTURE.md)**: System architecture and design
- **[Deployment Guide](./docs/DEPLOYMENT_GUIDE.md)**: Step-by-step deployment instructions
- **[SPL Token Integration](./docs/SPL_TOKEN_INTEGRATION.md)**: Token integration guide
- **[Security Analysis](./docs/SECURITY_ANALYSIS.md)**: Security controls and analysis
- **[API Documentation](../cvmsback/docs/API_DOCUMENTATION.md)**: Backend API reference

## Program ID

- **Testnet**: `5qgA2qcz6zXYiJJkomV1LJv8UhKueyNsqeCWJd6jC9pT`
- **Mainnet**: TBD

## Development

### Building

```bash
# Build for local development
anchor build

# Build for specific cluster
anchor build -- --features testnet
```

### Testing

```bash
# Run all tests
anchor test

# Run specific test suite
anchor test tests/integration.spec.ts
```

### Code Quality

```bash
# Format code
yarn lint:fix

# Check formatting
yarn lint
```

## Security

This program has been designed with security as a top priority:

- ✅ Comprehensive input validation
- ✅ Checked arithmetic (overflow/underflow protection)
- ✅ Account constraint validation
- ✅ Access control and authorization
- ✅ Rate limiting and timelocks
- ✅ Multisig support

**⚠️ Important**: This program has not undergone a professional security audit. Use at your own risk.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

ISC

## Support

For issues, questions, or contributions, please open an issue on the repository.

## Related Projects

- **[Backend API](../cvmsback/): Rust backend service for vault management
- **[Documentation](./docs/): Comprehensive documentation**
