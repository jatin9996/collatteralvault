# Collateral Vault Management System — Flows

**Document version:** 1.0  
**Based on:** Current implementation  
**Purpose:** Client-facing description of main user and system flows.

---

## 1. Flow Summary

| Flow | Actor | Main instruction(s) | Result |
|------|--------|------------------------|--------|
| Setup Vault Authority | Governance | `initialize_vault_authority` | Global config: authorized programs, freeze |
| Create User Vault | User | `initialize_vault` | PDA vault + USDT ATA for user |
| Deposit | User | `deposit` | USDT user → vault; balances updated |
| Lock (open position) | Position Manager (CPI) | `lock_collateral` | available → locked |
| Unlock (close position) | Position Manager (CPI) | `unlock_collateral` | locked → available |
| Withdraw | User | `withdraw` | USDT vault → user (only if no open positions) |
| Transfer between vaults | Position Manager (CPI) | `transfer_collateral` | Vault A → Vault B (e.g. settlement) |

---

## 2. Setup Flow (One-Time / Governance)

**Goal:** Create global Vault Authority so that the Position Manager (or other programs) can call lock/unlock/transfer via CPI.

```
Governance (signer)
       │
       ▼
initialize_vault_authority(authorized_programs, freeze?)
       │
       ├── Creates: VaultAuthority PDA ["vault_authority"]
       ├── governance = signer
       ├── authorized_programs = [position_manager_program_id, ...]
       ├── freeze = false
       └── cpi_enforced = false (or true for strict CPI-origin check)
```

**Later (optional):**

- `add_authorized_program` / `remove_authorized_program` — update allowlist
- `set_freeze_flag(true)` — disable all lock/unlock/transfer CPIs
- `set_cpi_enforced(true)` — require CPI caller to match instruction origin

---

## 3. User Vault Lifecycle

### 3.1 Initialize User Vault

**Actor:** User (signer)  
**Goal:** Create a vault PDA and a USDT token account (ATA) owned by that vault.

```
User (signer)
       │
       ▼
initialize_vault()
       │
       ├── Creates: Vault PDA seeds = ["vault", user.key()]
       ├── Creates: Vault ATA (USDT) with authority = Vault PDA
       ├── vault.owner = user
       ├── vault.token_account = vault ATA
       ├── vault.usdt_mint = provided mint
       ├── vault.total_balance = 0, locked_balance = 0, available_balance = 0
       └── vault.created_at, vault.bump stored
```

**Accounts:** user, vault (PDA), vault_token_account (ATA), usdt_mint, system/token/associated_token programs, rent.

---

### 3.2 Deposit Collateral

**Actor:** User (or delegate; signer)  
**Goal:** Move USDT from user wallet into the vault; update vault balances.

```
User (signer) — same as vault owner (or delegate)
       │
       ▼
deposit(amount)
       │
       ├── Validates: amount >= MIN_DEPOSIT; token accounts match vault mint/owner
       ├── SPL CPI: transfer(amount) from user_token_account → vault_token_account (user signs)
       ├── vault.total_balance += amount
       ├── vault.available_balance += amount
       ├── vault.total_deposited += amount
       └── Emits: DepositEvent, TransactionEvent(Deposit)
```

**Accounts:** authority (signer), owner, vault, user_token_account, vault_token_account, token_program.

---

### 3.3 Withdraw Collateral

**Actor:** Vault owner (or delegate / multisig)  
**Goal:** Move USDT from vault back to user wallet, only when no open positions and no locked balance.

```
User (signer) — vault owner or delegate
       │
       ▼
withdraw(amount)
       │
       ├── Validates: amount > 0; authority is owner or delegate (or multisig satisfied)
       ├── If VaultAuthority has authorized_programs:
       │   └── remaining_accounts = one Position Summary per authorized program
       │       Each summary: vault, owner, open_positions == 0, locked_amount == 0
       ├── Validates: vault.locked_balance == 0; available_balance >= amount
       ├── Optional: min withdraw delay, rate limit, whitelist checks
       ├── SPL CPI: transfer(amount) from vault_token_account → user_token_account (Vault PDA signs)
       ├── vault.total_balance -= amount; available_balance -= amount; total_withdrawn += amount
       └── Emits: WithdrawEvent, TransactionEvent(Withdrawal)
```

**Important:** If any authorized program (e.g. Position Manager) exists, the client must supply one position summary account per authorized program; each must report no open positions and no locked amount for this vault. Otherwise withdraw fails (OpenPositionsExist).

**Accounts:** authority, owner, vault, vault_authority, vault_token_account, user_token_account, token_program, remaining_accounts (position summaries when authorized_programs non-empty).

---

## 4. Position Manager Flows (CPI)

The Position Manager (or any program in `authorized_programs`) calls into the Collateral Vault to lock, unlock, or transfer collateral. The vault verifies the **caller program ID** (from the instruction stack) against `VaultAuthority.authorized_programs`; optionally `cpi_enforced` ensures the declared caller matches the actual caller.

### 4.1 Lock Collateral (Open Position)

**Actor:** Position Manager (CPI from its `open_position`-style instruction)  
**Goal:** Reserve collateral as margin for an open position; user cannot withdraw it until unlocked.

```
Position Manager: open_position(amount)
       │
       ├── Updates its own Position Summary: open_positions += 1, locked_amount += amount
       │
       ▼  CPI
collateral_vault::lock_collateral(amount)
       │
       ├── Resolves caller program from instruction sysvar; checks caller in authorized_programs
       ├── Optional: if cpi_enforced, caller_program account must match resolved caller
       ├── Validates: vault.available_balance >= amount; !vault_authority.freeze
       ├── vault.locked_balance += amount
       ├── vault.available_balance -= amount
       └── Emits: LockEvent, TransactionEvent(Lock)
```

**No SPL transfer:** Lock only updates vault state (locked vs available).

---

### 4.2 Unlock Collateral (Close Position)

**Actor:** Position Manager (CPI from its `close_position`-style instruction)  
**Goal:** Release margin when a position is closed; collateral becomes available again.

```
Position Manager: close_position(amount)
       │
       ├── Updates its own Position Summary: open_positions -= 1, locked_amount -= amount
       │
       ▼  CPI
collateral_vault::unlock_collateral(amount)
       │
       ├── Caller must be in authorized_programs (and match if cpi_enforced)
       ├── Validates: vault.locked_balance >= amount; !freeze
       ├── vault.locked_balance -= amount
       ├── vault.available_balance += amount
       └── Emits: UnlockEvent, TransactionEvent(Unlock)
```

---

### 4.3 Transfer Collateral (Vault to Vault)

**Actor:** Position Manager (CPI from its `rebalance_collateral`-style instruction)  
**Goal:** Move USDT from one user’s vault to another (e.g. settlement, liquidation).

```
Position Manager: rebalance_collateral(amount)
       │
       ▼  CPI
collateral_vault::transfer_collateral(amount)
       │
       ├── Caller must be in authorized_programs (and match if cpi_enforced)
       ├── Validates: from_vault.usdt_mint == to_vault.usdt_mint; from_vault.available_balance >= amount
       ├── SPL CPI: transfer(amount) from_vault_ata → to_vault_ata (from_vault PDA signs)
       ├── from_vault: total_balance -= amount, available_balance -= amount
       ├── to_vault: total_balance += amount, available_balance += amount
       └── Emits: TransferEvent, TransactionEvent(Transfer) for both vaults
```

---

## 5. End-to-End User Journey (Example)

1. **Governance** (once): `initialize_vault_authority([position_manager_id], false)`.
2. **User:** `initialize_vault()` → vault PDA + vault USDT ATA created.
3. **User:** `deposit(10_000 USDT)` → user wallet → vault; `available_balance = 10_000`.
4. **User** opens a position on the perps UI → **Position Manager** calls `lock_collateral(3_000)` via CPI → `locked_balance = 3_000`, `available_balance = 7_000`.
5. **User** tries `withdraw(5_000)` → fails (open positions / locked balance) until Position Manager reports no positions.
6. **User** closes the position on the perps UI → **Position Manager** calls `unlock_collateral(3_000)` via CPI → `locked_balance = 0`, `available_balance = 10_000`.
7. **User:** `withdraw(5_000)` (with position summaries in remaining_accounts) → vault → user wallet; `available_balance = 5_000`.
8. **Settlement/liquidation:** Position Manager calls `transfer_collateral(1_000)` from User A’s vault to User B’s vault → both vault balances updated atomically.

---

## 6. Events (Indexing / Auditing)

The program emits Anchor events for off-chain indexing and analytics:

| Event | When |
|-------|------|
| DepositEvent | After successful deposit |
| WithdrawEvent | After successful withdraw |
| LockEvent | After lock_collateral (CPI) |
| UnlockEvent | After unlock_collateral (CPI) |
| TransferEvent | After transfer_collateral (CPI) |
| TransactionEvent | Every deposit/withdraw/lock/unlock/transfer (transaction_type + amount + timestamp) |

These can be consumed by a backend or indexer for history, balances, and compliance.

---

## 7. Related Documents

- **ARCHITECTURE.md** — System components, PDAs, security model.
- **README.md** — Build, test, deploy.
- **tests/requirements-flow.spec.ts** — Automated flow tests with sample data.
