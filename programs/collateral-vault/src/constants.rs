// PDA seeds
pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";

// Sizing limits
pub const MAX_AUTHORIZED_PROGRAMS: usize = 64; // conservative upper bound for admin list
pub const MAX_MULTISIG_SIGNERS: usize = 10; // upper bound for per-vault multisig signers
pub const MAX_DELEGATES: usize = 16; // per-vault user delegates allowed to act on owner's behalf
pub const MAX_TIMELOCKS: usize = 64; // max concurrent scheduled timelocks per vault

// Business rules
// Minimum deposit amount in smallest units (token decimals apply).
// Set to 1 to effectively mirror > 0, can be raised by code updates if required.
pub const MIN_DEPOSIT: u64 = 1;


