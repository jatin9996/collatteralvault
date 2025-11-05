use anchor_lang::prelude::*;

use crate::constants::{MAX_DELEGATES, VAULT_SEED};
use crate::error::ErrorCode;
use crate::state::CollateralVault;

pub fn add_delegate(ctx: Context<UpdateDelegates>, delegate: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    // prevent owner-self as a stored delegate (not harmful, but redundant)
    require!(delegate != vault.owner, ErrorCode::AlreadyExists);
    // prevent duplicates
    require!(!vault.delegates.iter().any(|d| *d == delegate), ErrorCode::AlreadyExists);
    // enforce capacity bound (Anchor will allocate space based on LEN)
    require!(vault.delegates.len() < MAX_DELEGATES, ErrorCode::Overflow);
    vault.delegates.push(delegate);
    Ok(())
}

pub fn remove_delegate(ctx: Context<UpdateDelegates>, delegate: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    if let Some(i) = vault.delegates.iter().position(|d| *d == delegate) {
        vault.delegates.swap_remove(i);
        Ok(())
    } else {
        err!(ErrorCode::NotFound)
    }
}

#[derive(Accounts)]
pub struct UpdateDelegates<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,
}


