use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{VAULT_AUTHORITY_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::events::{EmergencyWithdrawEvent, TransactionEvent};
use crate::state::{CollateralVault, VaultAuthority};
use crate::types::TransactionType;

pub fn handler(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let authority_key = ctx.accounts.authority.key();
    let owner_key = ctx.accounts.owner.key();
    let governance = ctx.accounts.vault_authority.governance;

    let vault_bump = ctx.accounts.vault.bump;
    let vault_key = ctx.accounts.vault.key();
    let usdt_mint = ctx.accounts.vault.usdt_mint;

    // Authorization: only owner or governance
    let is_governance = authority_key == governance;
    let is_owner = authority_key == owner_key;
    require!(is_governance || is_owner, ErrorCode::Unauthorized);

    // Token account checks
    require_keys_eq!(ctx.accounts.user_token_account.owner, ctx.accounts.owner.key(), ErrorCode::Unauthorized);
    require_keys_eq!(ctx.accounts.user_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(ctx.accounts.vault_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(ctx.accounts.vault_token_account.owner, vault_key, ErrorCode::Unauthorized);

    // Explicitly assert token program owners of token accounts
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

    let vault = &mut ctx.accounts.vault;

    if is_governance {
        // Governance path: bypass normal invariants, but cap by total balance
        require!(vault.total_balance >= amount, ErrorCode::InsufficientFunds);

        // Deduct from available first, then from locked
        let from_available = core::cmp::min(amount, vault.available_balance);
        vault.available_balance = vault
            .available_balance
            .checked_sub(from_available)
            .ok_or(ErrorCode::Overflow)?;
        let remaining = amount
            .checked_sub(from_available)
            .ok_or(ErrorCode::Overflow)?;
        if remaining > 0 {
            require!(vault.locked_balance >= remaining, ErrorCode::InsufficientFunds);
            vault.locked_balance = vault
                .locked_balance
                .checked_sub(remaining)
                .ok_or(ErrorCode::Overflow)?;
        }

        // Invariant: total = locked + available
        vault.total_balance = vault
            .total_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::Overflow)?;
        vault.total_withdrawn = vault
            .total_withdrawn
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
    } else {
        // Owner path: enforce normal withdraw invariants
        require!(vault.available_balance >= amount, ErrorCode::InsufficientFunds);
        require!(vault.locked_balance == 0, ErrorCode::OpenPositionsExist);

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
    }

    // PDA signer seeds: ["vault", owner]
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, owner_key.as_ref(), &[vault_bump]];
    let signer: &[&[&[u8]]] = &[signer_seeds];

    // Transfer tokens: vault -> user
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

    emit!(EmergencyWithdrawEvent {
        vault: vault.key(),
        owner: vault.owner,
        authority: authority_key,
        amount,
        new_total_balance: vault.total_balance,
        new_available_balance: vault.available_balance,
        new_locked_balance: vault.locked_balance,
    });

    emit!(TransactionEvent {
        vault: vault.key(),
        owner: vault.owner,
        transaction_type: TransactionType::EmergencyWithdrawal,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Owner pubkey used for PDA derivation; need not sign
    /// CHECK: used for seed derivation and equality check only
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


