use anchor_lang::prelude::*;

use crate::state::CollateralVault;

// Read-only helper; returns Ok so clients can fetch accounts
pub fn handler(_ctx: Context<GetVaultInfo>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct GetVaultInfo<'info> {
    pub vault: Account<'info, CollateralVault>,
}


