use anchor_lang::prelude::*;

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


