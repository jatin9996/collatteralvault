use anchor_lang::prelude::*;

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
    #[msg("Entry already exists")] 
    AlreadyExists,
    #[msg("Account not found")] 
    NotFound,
    #[msg("Vault operations are frozen")] 
    Frozen,
    #[msg("Balance invariant violated")] 
    InvariantViolation,
}


