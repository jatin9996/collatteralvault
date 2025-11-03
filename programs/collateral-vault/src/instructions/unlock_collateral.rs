use anchor_lang::prelude::*;

use crate::constants::VAULT_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::UnlockEvent;
use crate::state::{CollateralVault, VaultAuthority};

pub fn handler(ctx: Context<UnlockCollateral>, amount: u64) -> Result<()> {
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

    let vault = &mut ctx.accounts.vault;
    require!(vault.locked_balance >= amount, ErrorCode::InsufficientFunds);

    vault.locked_balance = vault
        .locked_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::Overflow)?;
    vault.available_balance = vault
        .available_balance
        .checked_add(amount)
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

    emit!(UnlockEvent {
        vault: vault.key(),
        owner: vault.owner,
        amount,
        new_locked_balance: vault.locked_balance,
        new_available_balance: vault.available_balance,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UnlockCollateral<'info> {
    /// CHECK: program id of the calling program, used for allowlist verification
    pub caller_program: UncheckedAccount<'info>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(mut)]
    pub vault: Account<'info, CollateralVault>,
}


