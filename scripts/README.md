# Scripts

This directory contains utility scripts for development, deployment, and testing.

## Deployment Scripts

- `deploy-testnet.sh` - Deploy to Solana testnet
- `verify-deployment.sh` - Verify deployment on-chain

## Development Scripts

- `test-and-deploy.sh` - Run tests and deploy
- `fix-mock-program-idl.sh` - Fix mock program IDL
- `fix-port-issue.sh` - Fix port conflicts
- `get-more-sol.sh` - Request SOL airdrop
- `get-wallet-info.sh` - Display wallet information
- `kill-port-8899.sh` - Kill process on port 8899
- `open-explorer.sh` - Open Solana Explorer

## Usage

All scripts should be run from the project root:

```bash
./scripts/deploy-testnet.sh
```

Make sure scripts are executable:

```bash
chmod +x scripts/*.sh
```
