use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

declare_id!("Ag5PZxbajsqFrZa6N8vgfc2r8rnejKdPpGNSxn4S29q5");

// PDA seeds
pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";

// Sizing limits
pub const MAX_AUTHORIZED_PROGRAMS: usize = 64; // conservative upper bound for admin list

#[program]
pub mod collateral_vault {
    use super::*;

    // Placeholder entrypoint kept for Step 0 baseline; real instructions start next steps
    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    // Initialize the global VaultAuthority PDA that governs which programs are authorized
    // to perform restricted operations (e.g., lock/unlock/transfer) via CPI.
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

    // Step 2 — initialize_vault
    // Creates the Vault PDA and the vault's ATA for the provided USDT mint.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        // Record bump from seeds
        let bump = ctx.bumps.vault;

        // Initialize vault state
        vault.owner = ctx.accounts.user.key();
        vault.token_account = ctx.accounts.vault_token_account.key();
        vault.usdt_mint = ctx.accounts.usdt_mint.key();
        vault.total_balance = 0;
        vault.locked_balance = 0;
        vault.available_balance = 0;
        vault.total_deposited = 0;
        vault.total_withdrawn = 0;
        vault.created_at = Clock::get()?.unix_timestamp;
        vault.bump = bump;

        Ok(())
    }

    // Step 3 — deposit
    // Moves tokens from the user's ATA into the vault's ATA and updates balances.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let vault = &mut ctx.accounts.vault;
        let user_token_account = &ctx.accounts.user_token_account;
        let vault_token_account = &ctx.accounts.vault_token_account;

        // Basic invariant checks
        require_keys_eq!(user_token_account.owner, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        require_keys_eq!(user_token_account.mint, vault.usdt_mint, ErrorCode::Unauthorized);
        require_keys_eq!(vault_token_account.mint, vault.usdt_mint, ErrorCode::Unauthorized);
        require_keys_eq!(vault_token_account.owner, vault.key(), ErrorCode::Unauthorized);

        // CPI: transfer tokens from user to vault ATA
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        // Update balances with checked arithmetic
        vault.total_balance = vault.total_balance.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        vault.available_balance = vault.available_balance.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        vault.total_deposited = vault.total_deposited.checked_add(amount).ok_or(ErrorCode::Overflow)?;

        emit!(DepositEvent {
            vault: vault.key(),
            owner: vault.owner,
            amount,
            new_total_balance: vault.total_balance,
            new_available_balance: vault.available_balance,
        });

        Ok(())
    }

    // Withdraw tokens from the vault's ATA back to the owner's ATA (only from available_balance)
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let user = &ctx.accounts.user;
        let user_token_account = &ctx.accounts.user_token_account;
        let vault_token_account = &ctx.accounts.vault_token_account;

        // Snapshot fields to avoid overlapping borrows
        let vault_owner = ctx.accounts.vault.owner;
        let vault_bump = ctx.accounts.vault.bump;
        let vault_key = ctx.accounts.vault.key();
        let usdt_mint = ctx.accounts.vault.usdt_mint;
        let available_balance = ctx.accounts.vault.available_balance;

        // Authorization and invariant checks
        require_keys_eq!(vault_owner, user.key(), ErrorCode::Unauthorized);
        require!(available_balance >= amount, ErrorCode::InsufficientFunds);
        require_keys_eq!(user_token_account.owner, user.key(), ErrorCode::Unauthorized);
        require_keys_eq!(user_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
        require_keys_eq!(vault_token_account.mint, usdt_mint, ErrorCode::Unauthorized);
        require_keys_eq!(vault_token_account.owner, vault_key, ErrorCode::Unauthorized);

        // Seeds for PDA signer: ["vault", vault.owner]
        let signer_seeds: &[&[u8]] = &[VAULT_SEED, vault_owner.as_ref(), &[vault_bump]];
        let signer: &[&[&[u8]]] = &[signer_seeds];

        // CPI: transfer from vault ATA to user's ATA, signed by vault PDA
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        // Update balances with checked arithmetic
        let vault = &mut ctx.accounts.vault;
        vault.total_balance = vault
            .total_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::Overflow)?;
        vault.available_balance = vault
            .available_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::Overflow)?;
        vault.total_withdrawn = vault
            .total_withdrawn
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        emit!(WithdrawEvent {
            vault: vault.key(),
            owner: vault.owner,
            amount,
            new_total_balance: vault.total_balance,
            new_available_balance: vault.available_balance,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = CollateralVault::LEN,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = usdt_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub usdt_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // Verify the provided vault PDA belongs to this user
    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // Verify the provided vault PDA belongs to this user
    #[account(
        mut,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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

// ----------------------------
// Accounts
// ----------------------------

#[account]
#[derive(InitSpace)]
pub struct CollateralVault {
    // owner/user who controls this vault (signs withdrawals, etc.)
    pub owner: Pubkey,                 // 32
    // The ATA that actually holds the collateral tokens (USDT)
    pub token_account: Pubkey,         // 32
    // Mint for collateral (USDT)
    pub usdt_mint: Pubkey,             // 32

    // Balances (in tokens' smallest unit)
    pub total_balance: u64,            // 8
    pub locked_balance: u64,           // 8
    pub available_balance: u64,        // 8

    // Running totals for analytics/auditing
    pub total_deposited: u64,          // 8
    pub total_withdrawn: u64,          // 8

    // Metadata
    pub created_at: i64,               // 8 (unix timestamp)
    pub bump: u8,                      // 1

    // Reserved for future upgrades to avoid migrations
    pub _reserved: [u8; 64],           // 64
}

impl CollateralVault {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 32  // token_account
        + 32  // usdt_mint
        + 8   // total_balance
        + 8   // locked_balance
        + 8   // available_balance
        + 8   // total_deposited
        + 8   // total_withdrawn
        + 8   // created_at
        + 1   // bump
        + 64; // reserved
}

#[account]
#[derive(InitSpace)]
pub struct VaultAuthority {
    // Governance signer allowed to update this authority account
    pub governance: Pubkey, // 32

    // List of programs allowed to call lock/unlock/transfer via CPI
    #[max_len(MAX_AUTHORIZED_PROGRAMS)]
    pub authorized_programs: Vec<Pubkey>, // 4 + N*32

    pub bump: u8,     // 1
    pub freeze: bool, // 1 (optional global freeze switch)

    pub _reserved: [u8; 64], // 64
}

impl VaultAuthority {
    pub const LEN: usize = 8  // discriminator
        + 32                  // governance
        + 4                   // vec length prefix
        + (MAX_AUTHORIZED_PROGRAMS * 32)
        + 1                   // bump
        + 1                   // freeze
        + 64;                 // reserved
}

// ----------------------------
// Events (for off-chain indexing)
// ----------------------------

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_total_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_total_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct LockEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_locked_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct UnlockEvent {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_locked_balance: u64,
    pub new_available_balance: u64,
}

#[event]
pub struct TransferEvent {
    pub from_vault: Pubkey,
    pub to_vault: Pubkey,
    pub amount: u64,
    pub from_new_total_balance: u64,
    pub to_new_total_balance: u64,
}

// ----------------------------
// Errors
// ----------------------------

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")] 
    InvalidAmount,
    #[msg("Unauthorized")] 
    Unauthorized,
    #[msg("Insufficient funds")] 
    InsufficientFunds,
    #[msg("Arithmetic overflow or underflow")] 
    Overflow,
    #[msg("Caller program is not authorized")] 
    UnauthorizedProgram,
    #[msg("Account already initialized")] 
    AlreadyInitialized,
    #[msg("Account not found")] 
    NotFound,
}

// ----------------------------
// Unit tests (serialization roundtrip)
// ----------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collateral_vault_serde_roundtrip() {
        let mut vault = CollateralVault {
            owner: Pubkey::new_unique(),
            token_account: Pubkey::new_unique(),
            usdt_mint: Pubkey::new_unique(),
            total_balance: 123,
            locked_balance: 45,
            available_balance: 78,
            total_deposited: 1000,
            total_withdrawn: 800,
            created_at: 1_700_000_000,
            bump: 254,
            _reserved: [0u8; 64],
        };

        // basic invariant: total = locked + available (not enforced here, but a common expectation)
        vault.total_balance = vault.locked_balance + vault.available_balance;

        let data = vault.try_to_vec().expect("serialize");
        let back = CollateralVault::try_from_slice(&data).expect("deserialize");
        assert_eq!(vault.owner, back.owner);
        assert_eq!(vault.token_account, back.token_account);
        assert_eq!(vault.usdt_mint, back.usdt_mint);
        assert_eq!(vault.total_balance, back.total_balance);
        assert_eq!(vault.locked_balance, back.locked_balance);
        assert_eq!(vault.available_balance, back.available_balance);
        assert_eq!(vault.total_deposited, back.total_deposited);
        assert_eq!(vault.total_withdrawn, back.total_withdrawn);
        assert_eq!(vault.created_at, back.created_at);
        assert_eq!(vault.bump, back.bump);
    }

    #[test]
    fn vault_authority_serde_roundtrip() {
        let governance = Pubkey::new_unique();
        let mut programs = Vec::new();
        for _ in 0..4 {
            programs.push(Pubkey::new_unique());
        }

        let va = VaultAuthority {
            governance,
            authorized_programs: programs.clone(),
            bump: 200,
            freeze: false,
            _reserved: [0u8; 64],
        };

        let data = va.try_to_vec().expect("serialize");
        let back = VaultAuthority::try_from_slice(&data).expect("deserialize");
        assert_eq!(back.governance, governance);
        assert_eq!(back.authorized_programs.len(), programs.len());
        assert_eq!(back.bump, 200);
        assert!(!back.freeze);
    }
}
