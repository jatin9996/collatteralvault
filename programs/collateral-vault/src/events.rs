use anchor_lang::prelude::*;
use crate::types::TransactionType;

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_total_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_total_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct LockEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_locked_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct UnlockEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_locked_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct TransferEvent {
    pub from_vault: Pubkey,
    pub to_vault: Pubkey,
    pub amount: u64,
    pub from_new_total_balance: u64,
    pub to_new_total_balance: u64,
}

#[event]
pub struct TransactionEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub transaction_type: TransactionType,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TimelockScheduledEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub unlock_time: i64,
    pub remaining_timelocks: u32,
}

#[event]
pub struct TimelocksReleasedEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub released_total: u64,
    pub remaining_timelocks: u32,
}

#[event]
pub struct VaultAuthorityInitializedEvent {
    pub governance: Pubkey,
    pub authorized_programs_len: u32,
    pub freeze: bool,
}

#[event]
pub struct AuthorizedProgramAddedEvent {
    pub program: Pubkey,
}

#[event]
pub struct AuthorizedProgramRemovedEvent {
    pub program: Pubkey,
}

#[event]
pub struct FreezeFlagSetEvent {
    pub freeze: bool,
}

#[event]
pub struct CpiEnforcedSetEvent {
    pub cpi_enforced: bool,
}

#[event]
pub struct UpdateUsdtMintEvent {
    pub vault: Pubkey,
    pub old_mint: Pubkey,
    pub new_mint: Pubkey,
}

#[event]
pub struct VaultClosedEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
}


