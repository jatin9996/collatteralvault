use anchor_lang::prelude::*;

declare_id!("Ag5PZxbajsqFrZa6N8vgfc2r8rnejKdPpGNSxn4S29q5");

#[program]
pub mod collateral_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
