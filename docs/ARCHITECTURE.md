# Collateral Vault Management System — Architecture

**Document version:** 1.0  
**Based on:** Current implementation (Anchor 0.32, Solana)  
**Purpose:** Client-facing system architecture for the custody layer of a decentralized perpetual futures exchange.

---

## 1. Overview

The **Collateral Vault Management System (CVMS)** is the **custody layer** that holds user collateral (USDT) in program-controlled vaults. It ensures:

- **Non-custodial** — Each user has an isolated vault (PDA); only the owner (or authorized delegate) can withdraw.
- **Real-time tracking** — Per-vault balances: `total`, `locked` (margin in use), `available` (withdrawable).
- **Trading integration** — External programs (e.g. perpetuals / position manager) lock/unlock collateral and transfer between vaults via **Cross-Program Invocation (CPI)**.
- **Security** — Only allowlisted programs can lock/unlock/transfer; withdrawals require proof of no open positions when those programs exist.

The system is built on **Solana** using the **Anchor** framework and **SPL Token** for USDT.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL ACTORS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  User (wallet)          │  Position Manager / Perps Program (CPI caller)     │
│  - Deposit/Withdraw     │  - Lock / Unlock / Transfer collateral            │
│  - Init vault           │  - Provides position summary for withdrawals      │
└────────────┬────────────┴────────────────────────────┬──────────────────────┘
             │                                         │
             │  Direct calls                            │  CPI (authorized only)
             ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COLLATERAL VAULT PROGRAM (this system)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Instructions (user-facing)     │  Instructions (CPI-only)                    │
│  • initialize_vault            │  • lock_collateral                           │
│  • deposit                     │  • unlock_collateral                         │
│  • withdraw                    │  • transfer_collateral                       │
│  • + multisig, timelock,       │  (callable only by authorized_programs)       │
│    policy, delegation, etc.   │                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Global config: VaultAuthority (governance, authorized_programs, freeze)      │
│  Per-user state: CollateralVault (owner, balances, token_account, policy)     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                │  SPL Token CPI
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPL Token Program  │  User ATAs (USDT)  │  Vault ATAs (USDT, PDA-owned)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Programs

| Program | Role | Program ID (example) |
|--------|------|------------------------|
| **Collateral Vault** | Custody: create vaults, deposit/withdraw, enforce lock/unlock/transfer rules | `5qgA2qcz6zXYiJJkomV1LJv8UhKueyNsqeCWJd6jC9pT` |
| **Position Manager** (external) | Trading: open/close positions, lock/unlock margin via CPI; provides position summary for withdrawals | e.g. `9kL3B4VKXhF6nZwW3yQZUJnSfgfR1ZDmrgiStQaQkx9n` (mock) |
| **SPL Token** | Token transfers (user ↔ vault, vault ↔ vault) | Solana system |

The Collateral Vault program **does not** execute trading logic; it only holds collateral and updates `locked` / `available` when the Position Manager (or another authorized program) calls `lock_collateral` / `unlock_collateral` / `transfer_collateral` via CPI.

### 3.2 Program-Derived Addresses (PDAs)

All vault and authority accounts are **PDAs** so that only the program can modify them and, where needed, sign for token transfers.

| PDA | Seeds | Program | Purpose |
|-----|-------|---------|---------|
| **Vault** | `["vault", user_pubkey]` | Collateral Vault | One vault per user; holds balance state and points to vault USDT ATA |
| **Vault Token Account (ATA)** | Standard ATA: `[wallet=vault_pda, mint=usdt_mint]` | SPL Associated Token | Holds USDT; owner = Vault PDA (program signs for transfers) |
| **Vault Authority** | `["vault_authority"]` | Collateral Vault | Global config: governance, list of authorized programs, freeze, CPI enforcement |
| **Position Summary** (in Position Manager) | `["position_summary", vault_pda]` | Position Manager | Per-vault summary: open_positions, locked_amount; supplied at withdraw |

Invariants:

- **Vault PDA** → owns exactly one **Vault ATA** (USDT) per `usdt_mint`.
- **total_balance = locked_balance + available_balance** at all times.

### 3.3 Account Types (State)

**CollateralVault** (per user):

- **Identity:** `owner`, `token_account`, `usdt_mint`, `bump`, `created_at`
- **Balances:** `total_balance`, `locked_balance`, `available_balance`
- **Totals:** `total_deposited`, `total_withdrawn`
- **Trading:** Lock/unlock/transfer only via CPI; `available_balance` is what can be withdrawn
- **Optional:** Multisig, delegates, timelocks, min withdraw delay, rate limits, whitelist, yield fields (see code for full layout)

**VaultAuthority** (global, one per deployment):

- **Governance:** `governance` (signer for admin updates)
- **CPI:** `authorized_programs` (program IDs allowed to call lock/unlock/transfer)
- **Security:** `freeze`, `cpi_enforced` (when true, CPI caller must match instruction origin)
- **Optional:** `yield_whitelist`, `risk_level`

**Position Summary** (in Position Manager program):

- `vault`, `owner`, `open_positions`, `locked_amount`, `last_updated_slot`
- Used at withdraw: when `authorized_programs` is non-empty, the vault program requires one summary per authorized program; each must report `open_positions == 0` and `locked_amount == 0` before withdrawal is allowed.

---

## 4. Security Model

- **Custody:** Only the Collateral Vault program controls vault PDAs and vault ATAs; users never hold vault private keys.
- **Withdrawals:** Only vault `owner` (or configured delegates / multisig) can withdraw; recipient must be owner or on `withdraw_whitelist`.
- **Lock/Unlock/Transfer:** Only programs in `VaultAuthority.authorized_programs` can call these instructions; optional `cpi_enforced` checks the actual CPI caller.
- **Withdraw vs positions:** If any authorized program exists, withdraw requires position summaries showing no open positions and no locked amount for that vault.
- **Arithmetic:** Checked add/sub to prevent overflow/underflow; state updates are atomic within the transaction.
- **Freeze:** `VaultAuthority.freeze` can disable all lock/unlock/transfer CPIs globally.

---

## 5. Token Flow (Conceptual)

- **Deposit:** User’s USDT ATA → Vault ATA (SPL transfer signed by user). Vault `total_balance` and `available_balance` increase.
- **Withdraw:** Vault ATA → User’s USDT ATA (SPL transfer signed by Vault PDA). Vault `total_balance` and `available_balance` decrease. Allowed only when no open positions (per position summaries) and no locked balance.
- **Lock (CPI):** No token move; vault `locked_balance` increases, `available_balance` decreases. Used when opening a position.
- **Unlock (CPI):** No token move; vault `locked_balance` decreases, `available_balance` increases. Used when closing a position.
- **Transfer (CPI):** Vault A → Vault B (SPL transfer signed by Vault A PDA). Used for settlements/liquidations between two users’ vaults.

---

## 6. Deployment Context

- **Cluster:** Configurable (localnet, devnet, testnet, mainnet).
- **Program IDs:** Set in `Anchor.toml` per cluster; Vault Authority is created once per deployment (e.g. by governance).
- **USDT mint:** Configurable per deployment; vault stores `usdt_mint` and can be updated (e.g. via `update_usdt_mint`) under governance for migration scenarios.

---

## 7. Related Documents

- **FLOW.md** — Step-by-step user and CPI flows (initialize, deposit, lock/unlock, withdraw, transfer).
- **README.md** — Repo overview, build, test, deploy.
- **REQUIREMENTS_COMPLIANCE.md** — Mapping of requirements to implementation.
