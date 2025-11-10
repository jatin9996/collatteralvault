use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{VAULT_AUTHORITY_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::events::{TransactionEvent, WithdrawEvent};
use crate::state::{CollateralVault, VaultAuthority};
use crate::types::{PositionSummary, TransactionType};

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

    let authorized_programs = ctx.accounts.vault_authority.authorized_programs.clone();
    require!(
        ctx.remaining_accounts.len() >= authorized_programs.len(),
        ErrorCode::PositionSummaryMissing
    );
    let (summary_accounts, signer_accounts) = ctx
        .remaining_accounts
        .split_at(authorized_programs.len());

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

        for ai in signer_accounts.iter() {
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

    // Before applying business invariants, auto-release any matured timelocks
    {
        let now = Clock::get()?.unix_timestamp;
        let vault_ref = &mut ctx.accounts.vault;
        let mut released_total: u64 = 0;
        let mut remaining: Vec<crate::types::TimelockEntry> = Vec::with_capacity(vault_ref.timelocks.len());
        for e in vault_ref.timelocks.iter() {
            if e.unlock_time <= now {
                released_total = released_total
                    .checked_add(e.amount)
                    .ok_or(ErrorCode::Overflow)?;
            } else {
                remaining.push(*e);
            }
        }
        if released_total > 0 {
            vault_ref.available_balance = vault_ref
                .available_balance
                .checked_add(released_total)
                .ok_or(ErrorCode::Overflow)?;
        }
        vault_ref.timelocks = remaining;
    }

    // Refresh available balance snapshot after potential timelock releases
    let available_balance = ctx.accounts.vault.available_balance;

    // Validate position summaries supplied by authorized programs
    if !authorized_programs.is_empty() {
        let mut covered: std::collections::BTreeSet<Pubkey> = std::collections::BTreeSet::new();
        for summary_ai in summary_accounts.iter() {
            let owner_program = *summary_ai.owner;
            require!(
                authorized_programs.iter().any(|p| *p == owner_program),
                ErrorCode::PositionSummaryInvalid
            );
            require!(!summary_ai.data_is_empty(), ErrorCode::PositionSummaryInvalid);
            let data = summary_ai.try_borrow_data()?;
            require!(data.len() >= 8, ErrorCode::PositionSummaryInvalid);
            let summary = PositionSummary::try_from_slice(&data[8..])
                .map_err(|_| ErrorCode::PositionSummaryInvalid)?;
            drop(data);
            require_keys_eq!(summary.vault, vault_key, ErrorCode::PositionSummaryInvalid);
            require_keys_eq!(summary.owner, vault_owner, ErrorCode::PositionSummaryInvalid);
            require!(summary.open_positions == 0, ErrorCode::OpenPositionsExist);
            require!(summary.locked_amount == 0, ErrorCode::OpenPositionsExist);
            covered.insert(owner_program);
        }
        require!(
            covered.len() == authorized_programs.len(),
            ErrorCode::PositionSummaryMissing
        );
    }

    // Business invariants
    require!(available_balance >= amount, ErrorCode::InsufficientFunds);
    // Enforce no-open-positions rule (no locked funds)
    require!(ctx.accounts.vault.locked_balance == 0, ErrorCode::OpenPositionsExist);
    // Recipient must be owner or on whitelist
    {
        let recipient = user_token_account.owner;
        let is_owner = recipient == ctx.accounts.owner.key();
        let is_whitelisted = ctx.accounts
            .vault
            .withdraw_whitelist
            .iter()
            .any(|pk| *pk == recipient);
        require!(is_owner || is_whitelisted, ErrorCode::Unauthorized);
    }
    require_keys_eq!(user_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
    require_keys_eq!(vault_token_account.owner, vault_key, ErrorCode::Unauthorized);

    // Explicitly assert token accounts are owned by the token program
    require_keys_eq!(
		*ctx.accounts.user_token_account.to_account_info().owner,
        ctx.accounts.token_program.key(),
        ErrorCode::InvalidTokenProgramOwner
    );
    // Enforce minimum delay via matured pending withdrawals if configured
    {
        let now = Clock::get()?.unix_timestamp;
        let vault_ref = &mut ctx.accounts.vault;
        if vault_ref.min_withdraw_delay_seconds > 0 {
            let mut matured_total: u64 = 0;
            for e in vault_ref.pending_withdrawals.iter() {
                if e.executable_at <= now {
                    matured_total = matured_total.checked_add(e.amount).ok_or(ErrorCode::Overflow)?;
                }
            }
            require!(matured_total >= amount, ErrorCode::Unauthorized);

            // consume from matured entries
            let mut remaining: Vec<crate::types::PendingWithdrawalEntry> = Vec::with_capacity(vault_ref.pending_withdrawals.len());
            let mut to_consume = amount;
            for e in vault_ref.pending_withdrawals.iter() {
                if to_consume == 0 {
                    remaining.push(*e);
                    continue;
                }
                if e.executable_at <= now {
                    if e.amount <= to_consume {
                        to_consume = to_consume.checked_sub(e.amount).ok_or(ErrorCode::Overflow)?;
                        // drop this entry fully
                    } else {
                        // partially consume
                        let leftover = e.amount.checked_sub(to_consume).ok_or(ErrorCode::Overflow)?;
                        remaining.push(crate::types::PendingWithdrawalEntry { amount: leftover, requested_at: e.requested_at, executable_at: e.executable_at });
                        to_consume = 0;
                    }
                } else {
                    remaining.push(*e);
                }
            }
            vault_ref.pending_withdrawals = remaining;
        }
    }

    // Enforce rate limiting per vault if configured
    {
        let now = Clock::get()?.unix_timestamp;
        let vault_ref = &mut ctx.accounts.vault;
        if vault_ref.rate_window_seconds > 0 && vault_ref.rate_limit_amount > 0 {
            let window = vault_ref.rate_window_seconds as i64;
            if vault_ref.last_withdrawal_window_start == 0 || now >= vault_ref.last_withdrawal_window_start + window {
                vault_ref.last_withdrawal_window_start = now;
                vault_ref.withdrawn_in_window = 0;
            }
            let new_used = vault_ref.withdrawn_in_window.checked_add(amount).ok_or(ErrorCode::Overflow)?;
            require!(new_used <= vault_ref.rate_limit_amount, ErrorCode::Unauthorized);
            vault_ref.withdrawn_in_window = new_used;
        }
    }

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


