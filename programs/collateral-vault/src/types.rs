use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    Lock,
    Unlock,
    Transfer,
    EmergencyWithdrawal,
    YieldDeposit,
    YieldWithdraw,
    YieldCompound,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransactionRecord {
    pub vault: Pubkey,
    pub transaction_type: TransactionType,
    pub amount: u64,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct TimelockEntry {
    pub amount: u64,
    pub unlock_time: i64,
}


#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct PendingWithdrawalEntry {
    pub amount: u64,
    pub requested_at: i64,
    pub executable_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub struct PositionSummary {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub open_positions: u64,
    pub locked_amount: u64,
    pub last_updated_slot: u64,
}

impl PositionSummary {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8;
}


