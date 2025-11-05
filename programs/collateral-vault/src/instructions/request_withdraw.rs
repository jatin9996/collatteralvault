use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::WithdrawRequestedEvent;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<RequestWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;

    // Enforce min delay configured
    let delay = vault.min_withdraw_delay_seconds;
    require!(delay > 0, ErrorCode::Unauthorized);
    let exec_at = now
        .checked_add(delay)
        .ok_or(ErrorCode::Overflow)?;

    vault.pending_withdrawals.push(crate::types::PendingWithdrawalEntry {
        amount,
        requested_at: now,
        executable_at: exec_at,
    });

    emit!(WithdrawRequestedEvent {
        vault: vault.key(),
        owner: vault.owner,
        amount,
        requested_at: now,
        executable_at: exec_at,
        remaining_pending: vault.pending_withdrawals.len() as u32,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,
}


