use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::VAULT_SEED;
use crate::error::ErrorCode;
use crate::events::{TransactionEvent, WithdrawEvent};
use crate::types::TransactionType;
use crate::state::CollateralVault;

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let authority = &ctx.accounts.authority; // submitting signer (may or may not be the vault owner)
    let user_token_account = &ctx.accounts.user_token_account;
    let vault_token_account = &ctx.accounts.vault_token_account;

    // Snapshot fields to avoid overlapping borrows
    let vault_owner = ctx.accounts.vault.owner;
    let vault_bump = ctx.accounts.vault.bump;
    let vault_key = ctx.accounts.vault.key();
    let usdt_mint = ctx.accounts.vault.usdt_mint;
    let available_balance = ctx.accounts.vault.available_balance;

    // Authorization: single-owner or multisig
    let threshold = ctx.accounts.vault.multisig_threshold;
    if threshold == 0 {
        // single-owner mode: allow owner or any configured delegate
        let auth = authority.key();
        require!(
            auth == vault_owner || ctx.accounts.vault.delegates.iter().any(|d| *d == auth),
            ErrorCode::Unauthorized
        );
    } else {
        // multisig: require at least threshold unique configured signers to have signed
        let allowed: &Vec<Pubkey> = &ctx.accounts.vault.multisig_signers;
        require!(!allowed.is_empty(), ErrorCode::Unauthorized);
        require!((threshold as usize) <= allowed.len(), ErrorCode::Unauthorized);

        let mut approved: u8 = 0;
        let mut seen: std::collections::BTreeSet<Pubkey> = std::collections::BTreeSet::new();

        // count authority if it is in the allowed set
        if allowed.iter().any(|k| *k == authority.key()) {
            approved = approved.saturating_add(1);
            let _ = seen.insert(authority.key());
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

    // Business invariants
    require!(available_balance >= amount, ErrorCode::InsufficientFunds);
    // Enforce no-open-positions rule (no locked funds)
    require!(ctx.accounts.vault.locked_balance == 0, ErrorCode::OpenPositionsExist);
    // Withdrawals always return to the vault owner ATA
    require_keys_eq!(user_token_account.owner, ctx.accounts.owner.key(), ErrorCode::Unauthorized);
    require_keys_eq!(user_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.owner, vault_key, ErrorCode::Unauthorized);

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

    emit!(TransactionEvent {
        vault: vault.key(),
        owner: vault.owner,
        transaction_type: TransactionType::Withdrawal,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Owner pubkey used for PDA derivation; need not sign when multisig is enabled
    /// CHECK: used for seed derivation and equality check only
    pub owner: UncheckedAccount<'info>,

    // Verify the provided vault PDA belongs to this user
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


