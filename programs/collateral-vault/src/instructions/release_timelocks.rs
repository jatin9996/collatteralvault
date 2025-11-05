use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::TimelocksReleasedEvent;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<ReleaseTimelocks>) -> Result<()> {
    // Authorization: owner or delegates or multisig threshold (same rules as withdraw)
    let authority = &ctx.accounts.authority;
    let vault_owner = ctx.accounts.vault.owner;
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

    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;
    let mut released_total: u64 = 0;
    let mut remaining: Vec<crate::types::TimelockEntry> = Vec::with_capacity(vault.timelocks.len());
    for e in vault.timelocks.iter() {
        if e.unlock_time <= now {
            released_total = released_total
                .checked_add(e.amount)
                .ok_or(ErrorCode::Overflow)?;
        } else {
            remaining.push(*e);
        }
    }
    if released_total > 0 {
        vault.available_balance = vault
            .available_balance
            .checked_add(released_total)
            .ok_or(ErrorCode::Overflow)?;
    }
    vault.timelocks = remaining;

    emit!(TimelocksReleasedEvent {
        vault: vault.key(),
        owner: vault.owner,
        released_total,
        remaining_timelocks: vault.timelocks.len() as u32,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseTimelocks<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Owner pubkey used for seed derivation; need not sign when multisig is enabled
    /// CHECK: used for seed derivation and equality check only
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,
}


