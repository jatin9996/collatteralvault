use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::{TimelockScheduledEvent, TransactionEvent};
use crate::state::CollateralVault;
use crate::types::{TimelockEntry, TransactionType};

pub fn handler(ctx: Context<ScheduleTimelock>, amount: u64, duration_seconds: i64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(duration_seconds >= 0, ErrorCode::InvalidAmount);

    let authority = &ctx.accounts.authority; // submitting signer (may or may not be the vault owner)

    // Snapshot fields to avoid overlapping borrows
    let vault_owner = ctx.accounts.vault.owner;
    let available_balance = ctx.accounts.vault.available_balance;

    // Authorization: single-owner or multisig (reuse withdraw rules)
    let threshold = ctx.accounts.vault.multisig_threshold;
    if threshold == 0 {
        let auth = authority.key();
        require!(
            auth == vault_owner || ctx.accounts.vault.delegates.iter().any(|d| *d == auth),
            ErrorCode::Unauthorized
        );
    } else {
        let allowed: &Vec<Pubkey> = &ctx.accounts.vault.multisig_signers;
        require!(!allowed.is_empty(), ErrorCode::Unauthorized);
        require!((threshold as usize) <= allowed.len(), ErrorCode::Unauthorized);

        let mut approved: u8 = 0;
        let mut seen: std::collections::BTreeSet<Pubkey> = std::collections::BTreeSet::new();
        if allowed.iter().any(|k| *k == authority.key()) {
            approved = approved.saturating_add(1);
            let _ = seen.insert(authority.key());
        }
        for ai in ctx.remaining_accounts.iter() {
            if !ai.is_signer { continue; }
            if seen.contains(&ai.key()) { continue; }
            if allowed.iter().any(|k| *k == ai.key()) {
                approved = approved.saturating_add(1);
                let _ = seen.insert(ai.key());
                if approved >= threshold { break; }
            }
        }
        require!(approved >= threshold, ErrorCode::Unauthorized);
    }

    // Business rule: must have available funds to reserve
    require!(available_balance >= amount, ErrorCode::InsufficientFunds);

    // Compute unlock time and push entry
    let now = Clock::get()?.unix_timestamp;
    let unlock_time = now.checked_add(duration_seconds).ok_or(ErrorCode::Overflow)?;

    let vault = &mut ctx.accounts.vault;
    vault.available_balance = vault
        .available_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.timelocks.push(TimelockEntry { amount, unlock_time });

    emit!(TimelockScheduledEvent {
        vault: vault.key(),
        owner: vault.owner,
        amount,
        unlock_time,
        remaining_timelocks: vault.timelocks.len() as u32,
    });

    emit!(TransactionEvent {
        vault: vault.key(),
        owner: vault.owner,
        transaction_type: TransactionType::Withdrawal,
        amount,
        timestamp: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ScheduleTimelock<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Owner pubkey used for PDA derivation; need not sign when multisig is enabled
    /// CHECK: used for seed derivation and equality check only
    pub owner: UncheckedAccount<'info>,

    // Verify the provided vault PDA belongs to this user
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,
}


