use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;

// Re-export account context types at crate root to satisfy Anchor macro expectations
pub use instructions::initialize_vault::InitializeVault;
pub use instructions::deposit::Deposit;
pub use instructions::withdraw::Withdraw;
pub use instructions::lock_collateral::LockCollateral;
pub use instructions::unlock_collateral::UnlockCollateral;
pub use instructions::authority::{InitializeVaultAuthority, UpdateVaultAuthority};
pub use instructions::transfer_collateral::TransferCollateral;


declare_id!("Ag5PZxbajsqFrZa6N8vgfc2r8rnejKdPpGNSxn4S29q5");

#[program]
pub mod collateral_vault {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    pub fn lock_collateral(ctx: Context<LockCollateral>, amount: u64) -> Result<()> {
        instructions::lock_collateral::handler(ctx, amount)
    }

    pub fn unlock_collateral(ctx: Context<UnlockCollateral>, amount: u64) -> Result<()> {
        instructions::unlock_collateral::handler(ctx, amount)
    }

	pub fn transfer_collateral(ctx: Context<TransferCollateral>, amount: u64) -> Result<()> {
		instructions::transfer_collateral::handler(ctx, amount)
	}

    pub fn initialize_vault_authority(
        ctx: Context<InitializeVaultAuthority>,
        authorized_programs: Vec<Pubkey>,
        freeze: Option<bool>,
    ) -> Result<()> {
        instructions::authority::initialize_vault_authority(ctx, authorized_programs, freeze)
    }

    pub fn add_authorized_program(ctx: Context<UpdateVaultAuthority>, program: Pubkey) -> Result<()> {
        instructions::authority::add_authorized_program(ctx, program)
    }

    pub fn remove_authorized_program(ctx: Context<UpdateVaultAuthority>, program: Pubkey) -> Result<()> {
        instructions::authority::remove_authorized_program(ctx, program)
    }

    pub fn set_freeze_flag(ctx: Context<UpdateVaultAuthority>, freeze: bool) -> Result<()> {
        instructions::authority::set_freeze_flag(ctx, freeze)
    }
}

#[derive(Accounts)]
pub struct Initialize {}

// ----------------------------
// Unit tests (serialization roundtrip)
// ----------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::*;
    use crate::state::{CollateralVault, VaultAuthority};

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
