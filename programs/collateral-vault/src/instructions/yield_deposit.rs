use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::{TransactionEvent, YieldDepositEvent};
use crate::state::{CollateralVault, VaultAuthority};
use crate::types::TransactionType;

pub fn handler(ctx: Context<YieldDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    // Authorization: single-owner or multisig
    let threshold = ctx.accounts.vault.multisig_threshold;
    if threshold == 0 {
        // single-owner mode: allow owner or any configured delegate
        let auth = ctx.accounts.authority.key();
        require!(
            auth == ctx.accounts.owner.key()
                || ctx.accounts.vault.delegates.iter().any(|d| *d == auth),
            ErrorCode::Unauthorized
        );
    } else {
        // multisig: require at least threshold unique configured signers to have signed
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

    // Business invariants
    let vault = &mut ctx.accounts.vault;
    require!(vault.available_balance >= amount, ErrorCode::InsufficientFunds);

    // Accounting: move funds from available to yield_deposited
    vault.available_balance = vault
        .available_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.yield_deposited_balance = vault
        .yield_deposited_balance
        .checked_add(amount)
        .ok_or(ErrorCode::Overflow)?;
    if vault.active_yield_program == Pubkey::default() {
        vault.active_yield_program = yp;
    }

    emit!(YieldDepositEvent {
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
        transaction_type: TransactionType::YieldDeposit,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct YieldDeposit<'info> {
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

    /// The target yield program to route to (whitelisted)
    /// CHECK: used for key only
    pub yield_program: UncheckedAccount<'info>,
}


