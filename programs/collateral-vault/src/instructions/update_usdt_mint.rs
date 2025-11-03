use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::VAULT_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::UpdateUsdtMintEvent;
use crate::state::{CollateralVault, VaultAuthority};

pub fn handler(ctx: Context<UpdateUsdtMint>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Only allow when there are no funds at all
    require!(vault.total_balance == 0, ErrorCode::NonZeroBalance);
    require!(vault.locked_balance == 0, ErrorCode::NonZeroBalance);

    let old_mint = vault.usdt_mint;
    let new_mint = ctx.accounts.new_mint.key();

    vault.usdt_mint = new_mint;
    vault.token_account = ctx.accounts.vault_token_account.key();

    emit!(UpdateUsdtMintEvent {
        vault: vault.key(),
        old_mint,
        new_mint,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateUsdtMint<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault_authority.bump,
        has_one = governance @ ErrorCode::Unauthorized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(mut)]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        init_if_needed,
        payer = governance,
        associated_token::mint = new_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub new_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}


