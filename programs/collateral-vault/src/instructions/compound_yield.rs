use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::YieldCompoundEvent;
use crate::state::{CollateralVault, VaultAuthority};

pub fn handler(ctx: Context<CompoundYield>, compounded_amount: u64) -> Result<()> {
    // Authorization: single-owner or multisig
    let threshold = ctx.accounts.vault.multisig_threshold;
    if threshold == 0 {
        let auth = ctx.accounts.authority.key();
        require!(
            auth == ctx.accounts.owner.key()
                || ctx.accounts.vault.delegates.iter().any(|d| *d == auth),
            ErrorCode::Unauthorized
        );
    } else {
        let allowed: &Vec<Pubkey> = &ctx.accounts.vault.multisig_signers;
        require!(!allowed.is_empty(), ErrorCode::Unauthorized);
        require!((threshold as usize) <= allowed.len(), ErrorCode::Unauthorized);
        let mut approved: u8 = 0;
        let mut seen: std::collections::BTreeSet<Pubkey> = std::collections::BTreeSet::new();
        if allowed.iter().any(|k| *k == ctx.accounts.authority.key()) {
            approved = approved.saturating_add(1);
            let _ = seen.insert(ctx.accounts.authority.key());
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

    // Whitelist check for yield program
    let yp = ctx.accounts.yield_program.key();
    require!(
        ctx.accounts.vault_authority.yield_whitelist.iter().any(|p| *p == yp),
        ErrorCode::YieldProgramNotWhitelisted
    );

    let vault = &mut ctx.accounts.vault;
    if compounded_amount > 0 {
        require!(vault.yield_accrued_balance >= compounded_amount, ErrorCode::InsufficientYieldBalance);
        vault.yield_accrued_balance = vault
            .yield_accrued_balance
            .checked_sub(compounded_amount)
            .ok_or(ErrorCode::Overflow)?;
        vault.yield_deposited_balance = vault
            .yield_deposited_balance
            .checked_add(compounded_amount)
            .ok_or(ErrorCode::Overflow)?;
    }
    vault.last_compounded_at = Clock::get()?.unix_timestamp;
    if vault.active_yield_program == Pubkey::default() {
        vault.active_yield_program = yp;
    }

    emit!(YieldCompoundEvent {
        vault: vault.key(),
        owner: vault.owner,
        program: yp,
        compounded_amount,
        new_yield_balance: vault.yield_deposited_balance,
        last_compounded_at: vault.last_compounded_at,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CompoundYield<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Owner used for PDA seeds
    /// CHECK: seed/equality only
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    /// Vault authority for whitelist and policy checks
    #[account(
        seeds = [crate::constants::VAULT_AUTHORITY_SEED],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// The yield program to target (whitelisted)
    /// CHECK: used for key only
    pub yield_program: UncheckedAccount<'info>,
}


