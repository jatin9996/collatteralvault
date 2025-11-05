use anchor_lang::prelude::*;
use crate::constants::{MAX_DELEGATES, MAX_MULTISIG_SIGNERS};

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
        + 8   // created_at
        + 1   // bump
        + 1   // multisig_threshold
        + 4 + (MAX_MULTISIG_SIGNERS * 32) // multisig_signers vec
        + 4 + (MAX_DELEGATES * 32)        // delegates vec
        + 64; // reserved
}


