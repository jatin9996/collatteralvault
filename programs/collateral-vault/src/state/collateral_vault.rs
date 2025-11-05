use anchor_lang::prelude::*;
use crate::constants::{MAX_DELEGATES, MAX_MULTISIG_SIGNERS, MAX_TIMELOCKS, MAX_PENDING_WITHDRAWALS, MAX_WITHDRAW_WHITELIST};
use crate::types::{TimelockEntry, PendingWithdrawalEntry};

#[account]
#[derive(InitSpace)]
pub struct CollateralVault {
    // owner/user who controls this vault (signs withdrawals, etc.)
    pub owner: Pubkey,                 // 32
    // The ATA that actually holds the collateral tokens (USDT)
    pub token_account: Pubkey,         // 32
    // Mint for collateral (USDT)
    pub usdt_mint: Pubkey,             // 32

    // Balances (in tokens' smallest unit)
    pub total_balance: u64,            // 8
    pub locked_balance: u64,           // 8
    pub available_balance: u64,        // 8

    // Running totals for analytics/auditing
    pub total_deposited: u64,          // 8
    pub total_withdrawn: u64,          // 8

    // Yield strategy tracking
    pub yield_deposited_balance: u64,  // 8 - amount placed into yield protocols
    pub yield_accrued_balance: u64,    // 8 - unclaimed rewards accounted to the vault
    pub last_compounded_at: i64,       // 8 - unix timestamp of last compound
    pub active_yield_program: Pubkey,  // 32 - currently selected yield program id (0 if none)

    // Metadata
    pub created_at: i64,               // 8 (unix timestamp)
    pub bump: u8,                      // 1

    // Multisig config (threshold == 0 means disabled)
    pub multisig_threshold: u8,        // 1
    #[max_len(MAX_MULTISIG_SIGNERS)]
    pub multisig_signers: Vec<Pubkey>, // 4 + N*32

    // Per-vault delegated authorities (single-owner mode only)
    #[max_len(MAX_DELEGATES)]
    pub delegates: Vec<Pubkey>,        // 4 + M*32

    // Scheduled partial-withdraw timelocks (amount unlocks at unlock_time)
    #[max_len(MAX_TIMELOCKS)]
    pub timelocks: Vec<TimelockEntry>, // 4 + N*size(TimelockEntry)

    // Security: enforce minimum delay for withdrawals
    pub min_withdraw_delay_seconds: i64, // 8 (0 disables enforcement)
    // Pending withdrawal requests subject to min delay
    #[max_len(MAX_PENDING_WITHDRAWALS)]
    pub pending_withdrawals: Vec<PendingWithdrawalEntry>, // 4 + N*size(PendingWithdrawalEntry)

    // Security: withdrawal recipient whitelist (owners implicitly allowed)
    #[max_len(MAX_WITHDRAW_WHITELIST)]
    pub withdraw_whitelist: Vec<Pubkey>, // 4 + N*32

    // Rate limiting per time window per vault
    pub rate_window_seconds: u32,      // 4 (0 disables)
    pub rate_limit_amount: u64,        // 8 (max amount per window)
    pub last_withdrawal_window_start: i64, // 8 (unix ts of window start)
    pub withdrawn_in_window: u64,      // 8 (used amount in window)

    // Reserved for future upgrades to avoid migrations
    pub _reserved: [u8; 64],           // 64
}

impl CollateralVault {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 32  // token_account
        + 32  // usdt_mint
        + 8   // total_balance
        + 8   // locked_balance
        + 8   // available_balance
        + 8   // total_deposited
        + 8   // total_withdrawn
        + 8   // yield_deposited_balance
        + 8   // yield_accrued_balance
        + 8   // last_compounded_at
        + 32  // active_yield_program
        + 8   // created_at
        + 1   // bump
        + 1   // multisig_threshold
        + 4 + (MAX_MULTISIG_SIGNERS * 32) // multisig_signers vec
        + 4 + (MAX_DELEGATES * 32)        // delegates vec
        + 4 + (MAX_TIMELOCKS * (8 + 8))   // timelocks vec (u64 + i64)
        + 8   // min_withdraw_delay_seconds
        + 4 + (MAX_PENDING_WITHDRAWALS * (8 + 8 + 8)) // pending_withdrawals vec
        + 4 + (MAX_WITHDRAW_WHITELIST * 32) // withdraw_whitelist vec
        + 4   // rate_window_seconds
        + 8   // rate_limit_amount
        + 8   // last_withdrawal_window_start
        + 8   // withdrawn_in_window
        + 64; // reserved
}


