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

    // Resolve the actual caller program from the instructions sysvar
    let actual_caller = resolve_caller_program(&ctx.accounts.instructions)?;

    // Authorization: caller program must be in the allowlist
    require!(
        va.authorized_programs.iter().any(|p| *p == actual_caller),
        ErrorCode::UnauthorizedProgram
    );

    // Optional CPI-origin enforcement: ensure the declared caller matches the actual caller
    if va.cpi_enforced {
        require_keys_eq!(ctx.accounts.caller_program.key(), actual_caller, ErrorCode::UnauthorizedProgram);
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

	/// CHECK: Instructions sysvar account for CPI-origin verification when enforced
	#[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
	pub instructions: AccountInfo<'info>,

    #[account(mut)]
    pub vault: Account<'info, CollateralVault>,
}

fn resolve_caller_program(instructions: &AccountInfo<'_>) -> Result<Pubkey> {
    let current_index = sysvar_instructions::load_current_index_checked(instructions)?;
    require!(current_index > 0, ErrorCode::UnauthorizedProgram);
    let caller_ix = sysvar_instructions::load_instruction_at_checked((current_index - 1) as usize, instructions)?;
    Ok(caller_ix.program_id)
}


