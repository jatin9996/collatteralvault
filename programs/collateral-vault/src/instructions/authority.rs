use anchor_lang::prelude::*;

use crate::constants::{MAX_AUTHORIZED_PROGRAMS, VAULT_AUTHORITY_SEED};
use crate::error::ErrorCode;
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
    Ok(())
}

pub fn remove_authorized_program(
    ctx: Context<UpdateVaultAuthority>,
    program: Pubkey,
) -> Result<()> {
    let va = &mut ctx.accounts.vault_authority;
    if let Some(index) = va.authorized_programs.iter().position(|p| *p == program) {
        va.authorized_programs.swap_remove(index);
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


