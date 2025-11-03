use anchor_lang::prelude::*;

use crate::constants::VAULT_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::{LockEvent, TransactionEvent};
use crate::types::TransactionType;
use crate::state::{CollateralVault, VaultAuthority};
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

pub fn handler(ctx: Context<LockCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let va = &ctx.accounts.vault_authority;
    // Optional global freeze
    require!(!va.freeze, ErrorCode::Frozen);

    // Authorization: caller program must be in the allowlist
    let caller = ctx.accounts.caller_program.key();
    require!(
        va.authorized_programs.iter().any(|p| *p == caller),
        ErrorCode::UnauthorizedProgram
    );
    // Optional CPI-origin enforcement
    if va.cpi_enforced {
        let ix_ai = ctx.accounts.instructions.to_account_info();
        let idx = sysvar_instructions::load_current_index_checked(&ix_ai)?;
        require!(idx > 0, ErrorCode::UnauthorizedProgram);
        let prev = sysvar_instructions::load_instruction_at_checked((idx - 1) as usize, &ix_ai)?;
        require_keys_eq!(prev.program_id, caller, ErrorCode::UnauthorizedProgram);
    }

    let vault = &mut ctx.accounts.vault;
    require!(vault.available_balance >= amount, ErrorCode::InsufficientFunds);

    vault.locked_balance = vault
        .locked_balance
        .checked_add(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.available_balance = vault
        .available_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;

    // Invariant: total = locked + available
    require!(
        vault.total_balance
            == vault
                .locked_balance
                .checked_add(vault.available_balance)
                .ok_or(ErrorCode::Overflow)?,
        ErrorCode::InvariantViolation
    );

    emit!(LockEvent {
        vault: vault.key(),
        owner: vault.owner,
        amount,
        new_locked_balance: vault.locked_balance,
        new_available_balance: vault.available_balance,
    });

    emit!(TransactionEvent {
        vault: vault.key(),
        owner: vault.owner,
        transaction_type: TransactionType::Lock,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct LockCollateral<'info> {
    /// CHECK: program id of the calling program, used for allowlist verification
    pub caller_program: UncheckedAccount<'info>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// System Instructions sysvar for CPI-origin verification when enforced
    pub instructions: Sysvar<'info, Instructions>,

    #[account(mut)]
    pub vault: Account<'info, CollateralVault>,
}


