use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::AccountMeta, instruction::Instruction, program::invoke_signed};

pub fn build_metas_from_accounts<'info>(accounts: &[AccountInfo<'info>], signer_key: &Pubkey) -> Vec<AccountMeta> {
    accounts
        .iter()
        .map(|ai| AccountMeta {
            pubkey: ai.key(),
            is_signer: ai.is_signer || ai.key() == *signer_key,
            is_writable: ai.is_writable,
        })
        .collect()
}

pub fn invoke_external_with_signer<'info>(
    program_id: &Pubkey,
    remaining_accounts: &[AccountInfo<'info>],
    signer_key: &Pubkey,
    signer: &[&[&[u8]]],
    data: Vec<u8>,
) -> Result<()> {
    let metas = build_metas_from_accounts(remaining_accounts, signer_key);
    let ix = Instruction { program_id: *program_id, accounts: metas, data };
    invoke_signed(&ix, remaining_accounts, signer).map_err(|e| error!("CPI invoke failed: {:?}", e)).or(Ok(()))
}


