use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::DepositEvent;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let vault = &mut ctx.accounts.vault;
    let user_token_account = &ctx.accounts.user_token_account;
    let vault_token_account = &ctx.accounts.vault_token_account;

    // Basic invariant checks
    require_keys_eq!(user_token_account.owner, ctx.accounts.user.key(), ErrorCode::Unauthorized);
    require_keys_eq!(user_token_account.mint, vault.usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.mint, vault.usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.owner, vault.key(), ErrorCode::Unauthorized);

    // CPI: transfer tokens from user to vault ATA
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
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

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // Verify the provided vault PDA belongs to this user
    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


