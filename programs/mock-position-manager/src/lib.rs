use anchor_lang::prelude::*;

// IMPORTANT: Program id must match Anchor.toml (programs.localnet.mock_position_manager)
declare_id!("EMHew6227FX9PUhDGKwc8FHsEASZf5Fd4GWryuEXokT");

#[program]
pub mod mock_position_manager {
    use super::*;

    // Open a mock position by locking collateral via CPI into collateral_vault
    pub fn open_position(ctx: Context<OpenPosition>, amount: u64) -> Result<()> {
        let cpi_program = ctx.accounts.collateral_vault_program.to_account_info();
        let cpi_accounts = collateral_vault::cpi::accounts::LockCollateral {
            caller_program: ctx.accounts.caller_program.to_account_info(),
            vault_authority: ctx.accounts.vault_authority.to_account_info(),
            instructions: ctx.accounts.instructions.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        collateral_vault::cpi::lock_collateral(cpi_ctx, amount)
    }

    // Close a mock position by unlocking collateral via CPI into collateral_vault
    pub fn close_position(ctx: Context<ClosePosition>, amount: u64) -> Result<()> {
        let cpi_program = ctx.accounts.collateral_vault_program.to_account_info();
        let cpi_accounts = collateral_vault::cpi::accounts::UnlockCollateral {
            caller_program: ctx.accounts.caller_program.to_account_info(),
            vault_authority: ctx.accounts.vault_authority.to_account_info(),
            instructions: ctx.accounts.instructions.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        collateral_vault::cpi::unlock_collateral(cpi_ctx, amount)
    }
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    /// CHECK: passed as an Unchecked account to be compared as the caller id on the downstream program
    pub caller_program: UncheckedAccount<'info>,

    /// Vault authority of the downstream program
    pub vault_authority: Account<'info, collateral_vault::state::VaultAuthority>,

    /// CHECK: address constraint pins this to the instructions sysvar PDA
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    /// Target vault to lock against
    pub vault: Account<'info, collateral_vault::state::CollateralVault>,

    /// The downstream program we are CPI-ing into
    pub collateral_vault_program: Program<'info, collateral_vault::program::CollateralVault>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    /// CHECK: passed as an Unchecked account to be compared as the caller id on the downstream program
    pub caller_program: UncheckedAccount<'info>,

    /// Vault authority of the downstream program
    pub vault_authority: Account<'info, collateral_vault::state::VaultAuthority>,

    /// CHECK: address constraint pins this to the instructions sysvar PDA
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    /// Target vault to unlock against
    pub vault: Account<'info, collateral_vault::state::CollateralVault>,

    /// The downstream program we are CPI-ing into
    pub collateral_vault_program: Program<'info, collateral_vault::program::CollateralVault>,
}


