use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::CollateralVault;

pub fn handler(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Record bump from seeds
    let bump = ctx.bumps.vault;

    // Initialize vault state
    vault.owner = ctx.accounts.user.key();
    vault.token_account = ctx.accounts.vault_token_account.key();
    vault.usdt_mint = ctx.accounts.usdt_mint.key();
    vault.total_balance = 0;
    vault.locked_balance = 0;
    vault.available_balance = 0;
    vault.total_deposited = 0;
    vault.total_withdrawn = 0;
    vault.created_at = Clock::get()?.unix_timestamp;
    vault.bump = bump;
    vault.multisig_threshold = 0; // disabled by default
    vault.multisig_signers.clear();
    vault.delegates.clear();

    Ok(())
}

use crate::constants::VAULT_SEED;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = CollateralVault::LEN,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = usdt_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub usdt_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}


