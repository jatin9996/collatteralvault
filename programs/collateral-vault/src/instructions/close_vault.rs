use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::VaultClosedEvent;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<CloseVault>) -> Result<()> {
    let vault = &ctx.accounts.vault;

    // Must be empty
    require!(vault.total_balance == 0, ErrorCode::NonZeroBalance);
    require!(vault.locked_balance == 0, ErrorCode::NonZeroBalance);
    require!(ctx.accounts.vault_token_account.amount == 0, ErrorCode::NonZeroBalance);

    // Close the vault's ATA (authority is vault PDA)
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, ctx.accounts.user.key().as_ref(), &[vault.bump]];
    let signer: &[&[&[u8]]] = &[signer_seeds];

    let cpi_accounts = CloseAccount {
        account: ctx.accounts.vault_token_account.to_account_info(),
        destination: ctx.accounts.user.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::close_account(cpi_ctx)?;

    // Vault account lamports will be returned to user via close = user attribute
    emit!(VaultClosedEvent {
        vault: vault.key(),
        owner: ctx.accounts.user.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump = vault.bump,
        close = user,
        constraint = vault.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut,
        constraint = vault_token_account.owner == vault.key() @ ErrorCode::Unauthorized,
        constraint = vault_token_account.mint == vault.usdt_mint @ ErrorCode::Unauthorized,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


