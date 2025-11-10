use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use collateral_vault::error::ErrorCode as CollateralError;
use collateral_vault::state::{CollateralVault as VaultState, VaultAuthority};
use collateral_vault::types::PositionSummary;

pub const POSITION_SUMMARY_SEED: &[u8] = b"position_summary";

// IMPORTANT: Program id must match Anchor.toml (programs.localnet.mock_position_manager)
declare_id!("EMHew6227FX9PUhDGKwc8FHsEASZf5Fd4GWryuEXokT");

#[program]
pub mod mock_position_manager {
    use super::*;

    pub fn init_position_summary(ctx: Context<InitPositionSummary>) -> Result<()> {
        let summary = &mut ctx.accounts.position_summary;
        summary.vault = ctx.accounts.vault.key();
        summary.owner = ctx.accounts.vault.owner;
        summary.open_positions = 0;
        summary.locked_amount = 0;
        summary.last_updated_slot = Clock::get()?.slot;
        Ok(())
    }

    // Open a mock position by locking collateral via CPI into collateral_vault
    pub fn open_position(ctx: Context<OpenPosition>, amount: u64) -> Result<()> {
        require!(amount > 0, CollateralError::InvalidAmount);

        let summary = &mut ctx.accounts.position_summary;
        summary.ensure_matches(&ctx.accounts.vault)?;
        summary.open_positions = summary
            .open_positions
            .checked_add(1)
            .ok_or(CollateralError::Overflow)?;
        summary.locked_amount = summary
            .locked_amount
            .checked_add(amount)
            .ok_or(CollateralError::Overflow)?;
        summary.last_updated_slot = Clock::get()?.slot;

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
        require!(amount > 0, CollateralError::InvalidAmount);

        let summary = &mut ctx.accounts.position_summary;
        summary.ensure_matches(&ctx.accounts.vault)?;
        require!(summary.open_positions > 0, CollateralError::Unauthorized);
        summary.open_positions = summary
            .open_positions
            .checked_sub(1)
            .ok_or(CollateralError::Overflow)?;
        summary.locked_amount = summary
            .locked_amount
            .checked_sub(amount)
            .ok_or(CollateralError::Overflow)?;
        summary.last_updated_slot = Clock::get()?.slot;

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

    pub fn rebalance_collateral(ctx: Context<RebalanceCollateral>, amount: u64) -> Result<()> {
        require!(amount > 0, CollateralError::InvalidAmount);

        let cpi_program = ctx.accounts.collateral_vault_program.to_account_info();
        let cpi_accounts = collateral_vault::cpi::accounts::TransferCollateral {
            caller_program: ctx.accounts.caller_program.to_account_info(),
            vault_authority: ctx.accounts.vault_authority.to_account_info(),
            instructions: ctx.accounts.instructions.to_account_info(),
            from_vault: ctx.accounts.from_vault.to_account_info(),
            to_vault: ctx.accounts.to_vault.to_account_info(),
            from_vault_token_account: ctx.accounts.from_vault_token_account.to_account_info(),
            to_vault_token_account: ctx.accounts.to_vault_token_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        collateral_vault::cpi::transfer_collateral(cpi_ctx, amount)
    }
}

#[derive(Accounts)]
pub struct InitPositionSummary<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, VaultState>,

    #[account(
        init,
        payer = payer,
        space = 8 + PositionSummaryAccount::SIZE,
        seeds = [POSITION_SUMMARY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub position_summary: Account<'info, PositionSummaryAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    /// CHECK: passed as an Unchecked account to be compared as the caller id on the downstream program
    pub caller_program: UncheckedAccount<'info>,

    /// Vault authority of the downstream program
    pub vault_authority: Account<'info, VaultAuthority>,

    /// CHECK: address constraint pins this to the instructions sysvar PDA
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    /// Target vault to lock against
    #[account(mut)]
    pub vault: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [POSITION_SUMMARY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub position_summary: Account<'info, PositionSummaryAccount>,

    /// The downstream program we are CPI-ing into
    pub collateral_vault_program: Program<'info, collateral_vault::program::CollateralVault>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    /// CHECK: passed as an Unchecked account to be compared as the caller id on the downstream program
    pub caller_program: UncheckedAccount<'info>,

    /// Vault authority of the downstream program
    pub vault_authority: Account<'info, VaultAuthority>,

    /// CHECK: address constraint pins this to the instructions sysvar PDA
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    /// Target vault to unlock against
    #[account(mut)]
    pub vault: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [POSITION_SUMMARY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub position_summary: Account<'info, PositionSummaryAccount>,

    /// The downstream program we are CPI-ing into
    pub collateral_vault_program: Program<'info, collateral_vault::program::CollateralVault>,
}

#[derive(Accounts)]
pub struct RebalanceCollateral<'info> {
    /// CHECK: passed as an Unchecked account to be compared as the caller id on the downstream program
    pub caller_program: UncheckedAccount<'info>,

    pub vault_authority: Account<'info, VaultAuthority>,

    /// CHECK: address constraint pins this to the instructions sysvar PDA
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    #[account(mut)]
    pub from_vault: Account<'info, VaultState>,

    #[account(mut)]
    pub to_vault: Account<'info, VaultState>,

    #[account(mut)]
    pub from_vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to_vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    pub collateral_vault_program: Program<'info, collateral_vault::program::CollateralVault>,
}

#[account]
pub struct PositionSummaryAccount {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub open_positions: u64,
    pub locked_amount: u64,
    pub last_updated_slot: u64,
}

impl PositionSummaryAccount {
    pub const SIZE: usize = PositionSummary::LEN;

    pub fn ensure_matches(&self, vault: &Account<VaultState>) -> Result<()> {
        require_keys_eq!(self.vault, vault.key(), CollateralError::Unauthorized);
        require_keys_eq!(self.owner, vault.owner, CollateralError::Unauthorized);
        Ok(())
    }
}
