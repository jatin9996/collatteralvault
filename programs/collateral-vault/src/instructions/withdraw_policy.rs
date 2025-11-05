use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::{WithdrawMinDelaySetEvent, WithdrawRateLimitSetEvent, WithdrawWhitelistUpdatedEvent};
use crate::state::CollateralVault;

pub fn set_min_delay(ctx: Context<UpdatePolicy>, seconds: i64) -> Result<()> {
    require!(seconds >= 0, ErrorCode::InvalidAmount);
    let vault = &mut ctx.accounts.vault;
    vault.min_withdraw_delay_seconds = seconds;
    emit!(WithdrawMinDelaySetEvent { vault: vault.key(), owner: vault.owner, seconds });
    Ok(())
}

pub fn set_rate_limit(ctx: Context<UpdatePolicy>, window_seconds: u32, max_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.rate_window_seconds = window_seconds;
    vault.rate_limit_amount = max_amount;
    // Reset window counters on policy change
    vault.last_withdrawal_window_start = 0;
    vault.withdrawn_in_window = 0;
    emit!(WithdrawRateLimitSetEvent {
        vault: vault.key(),
        owner: vault.owner,
        window_seconds,
        max_amount,
    });
    Ok(())
}

pub fn add_whitelist(ctx: Context<UpdatePolicy>, address: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(!vault.withdraw_whitelist.iter().any(|a| *a == address), ErrorCode::AlreadyExists);
    vault.withdraw_whitelist.push(address);
    emit!(WithdrawWhitelistUpdatedEvent { vault: vault.key(), owner: vault.owner, address, added: true, new_len: vault.withdraw_whitelist.len() as u32 });
    Ok(())
}

pub fn remove_whitelist(ctx: Context<UpdatePolicy>, address: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    if let Some(i) = vault.withdraw_whitelist.iter().position(|a| *a == address) {
        vault.withdraw_whitelist.swap_remove(i);
        emit!(WithdrawWhitelistUpdatedEvent { vault: vault.key(), owner: vault.owner, address, added: false, new_len: vault.withdraw_whitelist.len() as u32 });
        Ok(())
    } else {
        err!(ErrorCode::NotFound)
    }
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
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


