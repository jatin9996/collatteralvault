use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::{TransactionEvent, YieldWithdrawEvent};
use crate::state::{CollateralVault, VaultAuthority};
use crate::types::TransactionType;

pub fn handler(ctx: Context<YieldWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

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

    // Whitelist check for yield program (if provided)
    let yp = ctx.accounts.yield_program.key();
    require!(
        ctx.accounts.vault_authority.yield_whitelist.iter().any(|p| *p == yp),
        ErrorCode::YieldProgramNotWhitelisted
    );

    // Business invariants
    let vault = &mut ctx.accounts.vault;
    require!(vault.yield_deposited_balance >= amount, ErrorCode::InsufficientYieldBalance);

    // Accounting: move funds from yield_deposited to available
    vault.yield_deposited_balance = vault
        .yield_deposited_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.available_balance = vault
        .available_balance
        .checked_add(amount)
        .ok_or(ErrorCode::Overflow)?;

    emit!(YieldWithdrawEvent {
        vault: vault.key(),
        owner: vault.owner,
        program: yp,
        amount,
        new_yield_balance: vault.yield_deposited_balance,
        new_available_balance: vault.available_balance,
    });

    emit!(TransactionEvent {
        vault: vault.key(),
        owner: vault.owner,
        transaction_type: TransactionType::YieldWithdraw,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct YieldWithdraw<'info> {
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

    /// The yield program to withdraw from (whitelisted)
    /// CHECK: used for key only
    pub yield_program: UncheckedAccount<'info>,
}


