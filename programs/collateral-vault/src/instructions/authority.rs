use anchor_lang::prelude::*;

use crate::constants::{MAX_AUTHORIZED_PROGRAMS, VAULT_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::events::{
    AuthorizedProgramAddedEvent, AuthorizedProgramRemovedEvent, CpiEnforcedSetEvent,
    FreezeFlagSetEvent, VaultAuthorityInitializedEvent,
};
use crate::state::VaultAuthority;

pub fn initialize_vault_authority(
    ctx: Context<InitializeVaultAuthority>,
    authorized_programs: Vec<Pubkey>,
    freeze: Option<bool>,
) -> Result<()> {
    // Ensure the authorized list does not exceed our conservative cap
    require!(
        authorized_programs.len() <= MAX_AUTHORIZED_PROGRAMS,
        ErrorCode::Overflow
    );

    let va = &mut ctx.accounts.vault_authority;
    va.governance = ctx.accounts.governance.key();
    va.authorized_programs = authorized_programs;
    va.bump = ctx.bumps.vault_authority;
    va.freeze = freeze.unwrap_or(false);
    va.cpi_enforced = false;
    emit!(VaultAuthorityInitializedEvent {
        governance: va.governance,
        authorized_programs_len: va.authorized_programs.len() as u32,
        freeze: va.freeze,
    });
    Ok(())
}

pub fn add_authorized_program(
    ctx: Context<UpdateVaultAuthority>,
    program: Pubkey,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    // Prevent duplicates
    require!(!va.authorized_programs.iter().any(|p| *p == program), ErrorCode::AlreadyExists);
    // Enforce capacity bound
    require!(va.authorized_programs.len() < MAX_AUTHORIZED_PROGRAMS, ErrorCode::Overflow);
    va.authorized_programs.push(program);
    emit!(AuthorizedProgramAddedEvent { program });
    Ok(())
}

pub fn remove_authorized_program(
    ctx: Context<UpdateVaultAuthority>,
    program: Pubkey,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    if let Some(index) = va.authorized_programs.iter().position(|p| *p == program) {
        va.authorized_programs.swap_remove(index);
        emit!(AuthorizedProgramRemovedEvent { program });
        Ok(())
    } else {
        err!(ErrorCode::NotFound)
    }
}

pub fn set_freeze_flag(
    ctx: Context<UpdateVaultAuthority>,
    freeze: bool,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    va.freeze = freeze;
    emit!(FreezeFlagSetEvent { freeze });
    Ok(())
}

pub fn set_cpi_enforced(
    ctx: Context<UpdateVaultAuthority>,
    cpi_enforced: bool,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    va.cpi_enforced = cpi_enforced;
    emit!(CpiEnforcedSetEvent { cpi_enforced });
    Ok(())
}

pub fn add_yield_program(
    ctx: Context<UpdateVaultAuthority>,
    program: Pubkey,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    require!(!va.yield_whitelist.iter().any(|p| *p == program), ErrorCode::AlreadyExists);
    require!(va.yield_whitelist.len() < MAX_AUTHORIZED_PROGRAMS, ErrorCode::Overflow);
    va.yield_whitelist.push(program);
    Ok(())
}

pub fn remove_yield_program(
    ctx: Context<UpdateVaultAuthority>,
    program: Pubkey,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    if let Some(index) = va.yield_whitelist.iter().position(|p| *p == program) {
        va.yield_whitelist.swap_remove(index);
        Ok(())
    } else {
        err!(ErrorCode::NotFound)
    }
}

pub fn set_risk_level(
    ctx: Context<UpdateVaultAuthority>,
    risk_level: u8,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    va.risk_level = risk_level;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeVaultAuthority<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        init,
        payer = governance,
        space = VaultAuthority::LEN,
        seeds = [VAULT_AUTHORITY_SEED],
        bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateVaultAuthority<'info> {
    // Governance signer must match the one recorded on the authority account
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault_authority.bump,
        has_one = governance @ ErrorCode::Unauthorized,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,
}


