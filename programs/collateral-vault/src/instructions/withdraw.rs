use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::WithdrawEvent;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let user = &ctx.accounts.user;
    let user_token_account = &ctx.accounts.user_token_account;
    let vault_token_account = &ctx.accounts.vault_token_account;

    // Snapshot fields to avoid overlapping borrows
    let vault_owner = ctx.accounts.vault.owner;
    let vault_bump = ctx.accounts.vault.bump;
    let vault_key = ctx.accounts.vault.key();
    let usdt_mint = ctx.accounts.vault.usdt_mint;
    let available_balance = ctx.accounts.vault.available_balance;

    // Authorization and invariant checks
    require_keys_eq!(vault_owner, user.key(), ErrorCode::Unauthorized);
    require!(available_balance >= amount, ErrorCode::InsufficientFunds);
    require_keys_eq!(user_token_account.owner, user.key(), ErrorCode::Unauthorized);
    require_keys_eq!(user_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.owner, vault_key, ErrorCode::Unauthorized);

    // Seeds for PDA signer: ["vault", vault.owner]
    let signer_seeds: &[&[u8]] = &[crate::constants::VAULT_SEED, vault_owner.as_ref(), &[vault_bump]];
    let signer: &[&[&[u8]]] = &[signer_seeds];

    // CPI: transfer from vault ATA to user's ATA, signed by vault PDA
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    // Update balances with checked arithmetic
    let vault = &mut ctx.accounts.vault;
    vault.total_balance = vault
        .total_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.available_balance = vault
        .available_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.total_withdrawn = vault
        .total_withdrawn
        .checked_add(amount)
        .ok_or(ErrorCode::Overflow)?;

    emit!(WithdrawEvent {
        vault: vault.key(),
        owner: vault.owner,
        amount,
        new_total_balance: vault.total_balance,
        new_available_balance: vault.available_balance,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
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
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


