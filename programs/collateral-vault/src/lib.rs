use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod types;

#[allow(ambiguous_glob_reexports, hidden_glob_reexports)]
pub use instructions::*;



declare_id!("Af5t3U1fEgZQGkQ92uUANSvDRd4qNTBKTQ5tTs7n8g4q");

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

    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
        instructions::emergency_withdraw::handler(ctx, amount)
    }

    pub fn set_vault_multisig(ctx: Context<SetVaultMultisig>, signers: Vec<Pubkey>, threshold: u8) -> Result<()> {
        instructions::multisig::set_vault_multisig(ctx, signers, threshold)
    }

    pub fn disable_vault_multisig(ctx: Context<SetVaultMultisig>) -> Result<()> {
        instructions::multisig::disable_vault_multisig(ctx)
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

    pub fn schedule_timelock(ctx: Context<ScheduleTimelock>, amount: u64, duration_seconds: i64) -> Result<()> {
        instructions::schedule_timelock::handler(ctx, amount, duration_seconds)
    }

    pub fn release_timelocks(ctx: Context<ReleaseTimelocks>) -> Result<()> {
        instructions::release_timelocks::handler(ctx)
    }

    pub fn request_withdraw(ctx: Context<RequestWithdraw>, amount: u64) -> Result<()> {
        instructions::request_withdraw::handler(ctx, amount)
    }

    pub fn set_withdraw_min_delay(ctx: Context<UpdatePolicy>, seconds: i64) -> Result<()> {
        instructions::withdraw_policy::set_min_delay(ctx, seconds)
    }

    pub fn set_withdraw_rate_limit(ctx: Context<UpdatePolicy>, window_seconds: u32, max_amount: u64) -> Result<()> {
        instructions::withdraw_policy::set_rate_limit(ctx, window_seconds, max_amount)
    }

    pub fn add_withdraw_whitelist(ctx: Context<UpdatePolicy>, address: Pubkey) -> Result<()> {
        instructions::withdraw_policy::add_whitelist(ctx, address)
    }

    pub fn remove_withdraw_whitelist(ctx: Context<UpdatePolicy>, address: Pubkey) -> Result<()> {
        instructions::withdraw_policy::remove_whitelist(ctx, address)
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

    pub fn set_cpi_enforced(ctx: Context<UpdateVaultAuthority>, cpi_enforced: bool) -> Result<()> {
        instructions::authority::set_cpi_enforced(ctx, cpi_enforced)
    }

    pub fn add_yield_program(ctx: Context<UpdateVaultAuthority>, program: Pubkey) -> Result<()> {
        instructions::authority::add_yield_program(ctx, program)
    }

    pub fn remove_yield_program(ctx: Context<UpdateVaultAuthority>, program: Pubkey) -> Result<()> {
        instructions::authority::remove_yield_program(ctx, program)
    }

    pub fn set_risk_level(ctx: Context<UpdateVaultAuthority>, risk_level: u8) -> Result<()> {
        instructions::authority::set_risk_level(ctx, risk_level)
    }

    pub fn add_delegate(ctx: Context<UpdateDelegates>, delegate: Pubkey) -> Result<()> {
        instructions::delegation::add_delegate(ctx, delegate)
    }

    pub fn remove_delegate(ctx: Context<UpdateDelegates>, delegate: Pubkey) -> Result<()> {
        instructions::delegation::remove_delegate(ctx, delegate)
    }

    pub fn update_usdt_mint(ctx: Context<UpdateUsdtMint>) -> Result<()> {
        instructions::update_usdt_mint::handler(ctx)
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        instructions::close_vault::handler(ctx)
    }

    pub fn get_vault_info(_ctx: Context<GetVaultInfo>) -> Result<()> {
        Ok(())
    }

    pub fn yield_deposit(ctx: Context<YieldDeposit>, amount: u64) -> Result<()> {
        instructions::yield_deposit::handler(ctx, amount)
    }

    pub fn yield_withdraw(ctx: Context<YieldWithdraw>, amount: u64) -> Result<()> {
        instructions::yield_withdraw::handler(ctx, amount)
    }

    pub fn compound_yield(ctx: Context<CompoundYield>, compounded_amount: u64) -> Result<()> {
        instructions::compound_yield::handler(ctx, compounded_amount)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, anchor_lang::system_program::System>,
}

// ----------------------------
// Unit tests (serialization roundtrip)
// ----------------------------
#[cfg(test)]
mod tests {
    use super::*;
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
            yield_deposited_balance: 0,
            yield_accrued_balance: 0,
            last_compounded_at: 0,
            active_yield_program: Pubkey::default(),
            created_at: 1_700_000_000,
            bump: 254,
            multisig_threshold: 0,
            multisig_signers: vec![],
            delegates: vec![],
            timelocks: vec![],
            min_withdraw_delay_seconds: 0,
            pending_withdrawals: vec![],
            withdraw_whitelist: vec![],
            rate_window_seconds: 0,
            rate_limit_amount: 0,
            last_withdrawal_window_start: 0,
            withdrawn_in_window: 0,
            _reserved: [0u8; 64],
        };

        vault.total_balance = vault.locked_balance + vault.available_balance;

        let data = vault.try_to_vec().unwrap();
        let back = CollateralVault::try_from_slice(&data).unwrap();
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
        let programs = (0..4).map(|_| Pubkey::new_unique()).collect::<Vec<_>>();

        let va = VaultAuthority {
            governance,
            authorized_programs: programs.clone(),
            bump: 200,
            freeze: false,
            cpi_enforced: false,
            yield_whitelist: programs.clone(),
            risk_level: 0,
            _reserved: [0u8; 64],
        };

        let data = va.try_to_vec().unwrap();
        let back = VaultAuthority::try_from_slice(&data).unwrap();
        assert_eq!(back.governance, governance);
        assert_eq!(back.authorized_programs.len(), programs.len());
        assert_eq!(back.bump, 200);
        assert!(!back.freeze);
    }
}
