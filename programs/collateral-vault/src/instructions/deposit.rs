use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{MIN_DEPOSIT, VAULT_SEED};
use crate::error::ErrorCode;
use crate::events::{DepositEvent, TransactionEvent};
use crate::types::TransactionType;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount >= MIN_DEPOSIT, ErrorCode::InvalidAmount);

    let vault = &mut ctx.accounts.vault;
    let user_token_account = &ctx.accounts.user_token_account;
    let vault_token_account = &ctx.accounts.vault_token_account;

    // Basic invariant checks
    // Token owner must be the depositing authority (owner or delegate)
    require_keys_eq!(user_token_account.owner, ctx.accounts.authority.key(), ErrorCode::Unauthorized);
    require_keys_eq!(user_token_account.mint, vault.usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.mint, vault.usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.owner, vault.key(), ErrorCode::Unauthorized);

    // Explicitly assert token accounts are owned by the token program
    require_keys_eq!(
		*ctx.accounts.user_token_account.to_account_info().owner,
        ctx.accounts.token_program.key(),
        ErrorCode::InvalidTokenProgramOwner
    );
    require_keys_eq!(
		*ctx.accounts.vault_token_account.to_account_info().owner,
        ctx.accounts.token_program.key(),
        ErrorCode::InvalidTokenProgramOwner
    );

    // Authorization in single-owner mode: owner or delegate
    let threshold = ctx.accounts.vault.multisig_threshold;
    if threshold == 0 {
        let owner = ctx.accounts.owner.key();
        let auth = ctx.accounts.authority.key();
        require!(auth == owner || ctx.accounts.vault.delegates.iter().any(|d| *d == auth), ErrorCode::Unauthorized);
    } else {
        // In multisig mode, deposits must be initiated by the vault owner signer; delegates are ignored
        // This keeps semantics simple. Adjust if you need delegates to deposit under multisig.
        require_keys_eq!(ctx.accounts.owner.key(), ctx.accounts.authority.key(), ErrorCode::Unauthorized);
    }

    // CPI: transfer tokens from authority to vault ATA
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    // Update balances with checked arithmetic
    vault.total_balance = vault.total_balance.checked_add(amount).ok_or(ErrorCode::Overflow)?;
    vault.available_balance = vault.available_balance.checked_add(amount).ok_or(ErrorCode::Overflow)?;
    vault.total_deposited = vault.total_deposited.checked_add(amount).ok_or(ErrorCode::Overflow)?;

    emit!(DepositEvent {
        vault: vault.key(),
        owner: vault.owner,
        amount,
        new_total_balance: vault.total_balance,
        new_available_balance: vault.available_balance,
    });

    emit!(TransactionEvent {
        vault: vault.key(),
        owner: vault.owner,
        transaction_type: TransactionType::Deposit,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The vault owner; may be different from authority if delegate is depositing
    /// CHECK: used for seeds and equality checks
    pub owner: UncheckedAccount<'info>,

    // Verify the provided vault PDA belongs to this owner
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


