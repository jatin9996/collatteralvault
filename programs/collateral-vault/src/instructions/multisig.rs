use anchor_lang::prelude::*;

use crate::{constants::{VAULT_SEED, MAX_MULTISIG_SIGNERS}, error::ErrorCode, state::CollateralVault};

pub fn set_vault_multisig(ctx: Context<SetVaultMultisig>, signers: Vec<Pubkey>, threshold: u8) -> Result<()> {
    // Validate inputs
    require!((threshold as usize) <= signers.len(), ErrorCode::InvalidAmount);
    require!((signers.len() as usize) <= MAX_MULTISIG_SIGNERS, ErrorCode::InvalidAmount);

    // ensure unique signers
    let mut uniq = std::collections::BTreeSet::new();
    for k in signers.iter() { uniq.insert(*k); }
    require!(uniq.len() == signers.len(), ErrorCode::InvalidAmount);

    let vault = &mut ctx.accounts.vault;
    vault.multisig_threshold = threshold;
    vault.multisig_signers = signers;

    Ok(())
}

pub fn disable_vault_multisig(ctx: Context<SetVaultMultisig>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.multisig_threshold = 0;
    vault.multisig_signers.clear();
    Ok(())
}

#[derive(Accounts)]
pub struct SetVaultMultisig<'info> {
    /// Vault owner must authorize changes to multisig configuration
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,
}


