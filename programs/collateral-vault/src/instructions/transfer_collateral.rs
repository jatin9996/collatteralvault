use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{VAULT_AUTHORITY_SEED, VAULT_SEED};
use crate::error::ErrorCode;
use crate::events::{TransactionEvent, TransferEvent};
use crate::types::TransactionType;
use crate::state::{CollateralVault, VaultAuthority};
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

pub fn handler(ctx: Context<TransferCollateral>, amount: u64) -> Result<()> {
	require!(amount > 0, ErrorCode::InvalidAmount);

	let va = &ctx.accounts.vault_authority;
	// Optional global freeze
	require!(!va.freeze, ErrorCode::Frozen);

    let actual_caller = resolve_caller_program(&ctx.accounts.instructions)?;
    require!(
        va.authorized_programs.iter().any(|p| *p == actual_caller),
        ErrorCode::UnauthorizedProgram
    );
    if va.cpi_enforced {
        require_keys_eq!(ctx.accounts.caller_program.key(), actual_caller, ErrorCode::UnauthorizedProgram);
    }

	let from_vault = &mut ctx.accounts.from_vault;
	let to_vault = &mut ctx.accounts.to_vault;

	// Mint/owner checks for token accounts
	require_keys_eq!(from_vault.usdt_mint, to_vault.usdt_mint, ErrorCode::Unauthorized);
	require_keys_eq!(
		ctx.accounts.from_vault_token_account.mint,
		from_vault.usdt_mint,
		ErrorCode::Unauthorized
	);
	require_keys_eq!(
		ctx.accounts.to_vault_token_account.mint,
		to_vault.usdt_mint,
		ErrorCode::Unauthorized
	);
	require_keys_eq!(
		ctx.accounts.from_vault_token_account.owner,
		from_vault.key(),
		ErrorCode::Unauthorized
	);
	require_keys_eq!(
		ctx.accounts.to_vault_token_account.owner,
		to_vault.key(),
		ErrorCode::Unauthorized
	);

	// Explicitly assert token accounts are owned by the token program
	require_keys_eq!(
		*ctx.accounts.from_vault_token_account.to_account_info().owner,
		ctx.accounts.token_program.key(),
		ErrorCode::InvalidTokenProgramOwner
	);
	require_keys_eq!(
		*ctx.accounts.to_vault_token_account.to_account_info().owner,
		ctx.accounts.token_program.key(),
		ErrorCode::InvalidTokenProgramOwner
	);

    // Balance check
	require!(from_vault.available_balance >= amount, ErrorCode::InsufficientFunds);

	// Seeds for PDA signer: ["vault", from_vault.owner]
	let from_owner = from_vault.owner;
	let from_bump = from_vault.bump;
	let signer_seeds: &[&[u8]] = &[VAULT_SEED, from_owner.as_ref(), &[from_bump]];
	let signer: &[&[&[u8]]] = &[signer_seeds];

    // CPI: transfer from from_vault ATA to to_vault ATA, signed by from_vault PDA
	let cpi_accounts = anchor_spl::token::Transfer {
		from: ctx.accounts.from_vault_token_account.to_account_info(),
		to: ctx.accounts.to_vault_token_account.to_account_info(),
		authority: from_vault.to_account_info(),
	};
	let cpi_ctx = CpiContext::new_with_signer(
		ctx.accounts.token_program.to_account_info(),
		cpi_accounts,
		signer,
	);
    anchor_spl::token::transfer(cpi_ctx, amount)?;

	// Update balances with checked arithmetic
	from_vault.total_balance = from_vault
		.total_balance
		.checked_sub(amount)
		.ok_or(ErrorCode::Overflow)?;
	from_vault.available_balance = from_vault
		.available_balance
		.checked_sub(amount)
		.ok_or(ErrorCode::Overflow)?;
	to_vault.total_balance = to_vault
		.total_balance
		.checked_add(amount)
		.ok_or(ErrorCode::Overflow)?;
	to_vault.available_balance = to_vault
		.available_balance
		.checked_add(amount)
		.ok_or(ErrorCode::Overflow)?;

	// Invariant: total = locked + available
	require!(
		from_vault.total_balance
			== from_vault
				.locked_balance
				.checked_add(from_vault.available_balance)
				.ok_or(ErrorCode::Overflow)?,
		ErrorCode::InvariantViolation
	);
	require!(
		to_vault.total_balance
			== to_vault
				.locked_balance
				.checked_add(to_vault.available_balance)
				.ok_or(ErrorCode::Overflow)?,
		ErrorCode::InvariantViolation
	);

	emit!(TransferEvent {
		from_vault: from_vault.key(),
		to_vault: to_vault.key(),
		amount,
		from_new_total_balance: from_vault.total_balance,
		to_new_total_balance: to_vault.total_balance,
	});

    // Log per-vault transaction records for both sides
    emit!(TransactionEvent {
        vault: from_vault.key(),
        owner: from_vault.owner,
        transaction_type: TransactionType::Transfer,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    emit!(TransactionEvent {
        vault: to_vault.key(),
        owner: to_vault.owner,
        transaction_type: TransactionType::Transfer,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

	Ok(())
}

#[derive(Accounts)]
pub struct TransferCollateral<'info> {
	/// CHECK: program id of the calling program, used for allowlist verification
	pub caller_program: UncheckedAccount<'info>,

	#[account(
		seeds = [VAULT_AUTHORITY_SEED],
		bump = vault_authority.bump,
	)]
	pub vault_authority: Account<'info, VaultAuthority>,

	/// CHECK: Instructions sysvar account for CPI-origin verification when enforced
	#[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
	pub instructions: AccountInfo<'info>,

	#[account(mut)]
	pub from_vault: Account<'info, CollateralVault>,

	#[account(mut)]
	pub to_vault: Account<'info, CollateralVault>,

	#[account(mut)]
	pub from_vault_token_account: Account<'info, TokenAccount>,

	#[account(mut)]
	pub to_vault_token_account: Account<'info, TokenAccount>,

	pub token_program: Program<'info, Token>,
}

fn resolve_caller_program(instructions: &AccountInfo<'_>) -> Result<Pubkey> {
    let current_index = sysvar_instructions::load_current_index_checked(instructions)?;
    require!(current_index > 0, ErrorCode::UnauthorizedProgram);
    let caller_ix = sysvar_instructions::load_instruction_at_checked((current_index - 1) as usize, instructions)?;
    Ok(caller_ix.program_id)
}


