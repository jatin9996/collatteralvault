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
    #[msg("Vault has non-zero balance")]
    NonZeroBalance,
    #[msg("Invalid token account program owner")]
    InvalidTokenProgramOwner,
    #[msg("User has open positions (locked collateral present)")]
    OpenPositionsExist,
    #[msg("Yield program not whitelisted")] 
    YieldProgramNotWhitelisted,
    #[msg("Insufficient yield balance")] 
    InsufficientYieldBalance,
    #[msg("Missing position summary for authorized program")]
    PositionSummaryMissing,
    #[msg("Invalid position summary supplied")]
    PositionSummaryInvalid,
}


