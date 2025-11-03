use anchor_lang::prelude::*;
use crate::constants::MAX_AUTHORIZED_PROGRAMS;

#[account]
#[derive(InitSpace)]
pub struct VaultAuthority {
    // Governance signer allowed to update this authority account
    pub governance: Pubkey, // 32

    // List of programs allowed to call lock/unlock/transfer via CPI
    #[max_len(MAX_AUTHORIZED_PROGRAMS)]
    pub authorized_programs: Vec<Pubkey>, // 4 + N*32

    pub bump: u8,     // 1
    pub freeze: bool, // 1 (optional global freeze switch)
    // When true, lock/unlock/transfer require CPI-origin check against an allowlisted program
    pub cpi_enforced: bool, // 1

    pub _reserved: [u8; 64], // 64
}

impl VaultAuthority {
    pub const LEN: usize = 8  // discriminator
        + 32                  // governance
        + 4                   // vec length prefix
        + (MAX_AUTHORIZED_PROGRAMS * 32)
        + 1                   // bump
        + 1                   // freeze
        + 1                   // cpi_enforced
        + 64;                 // reserved
}


