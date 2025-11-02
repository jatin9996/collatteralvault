import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { CollateralVault } from "../target/types/collateral_vault";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("collateral-vault", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.collateralVault as Program<CollateralVault>;

  it("initialize_vault creates PDA vault and ATA", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    // Airdrop SOL to cover fees if needed
    await connection.confirmTransaction(
      await connection.requestAirdrop(user.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Create a USDT mint (6 decimals)
    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    // Ensure the user has an ATA and some tokens to later test deposits
    const userAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      user.publicKey
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      userAta.address,
      user.publicKey,
      1_000_000_000n // 1000 USDT with 6 decimals
    );

    // Compute expected Vault PDA
    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), user.publicKey.toBuffer()],
      program.programId
    );

    // Compute expected Vault ATA (authority = vault PDA)
    const expectedVaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    // Call initialize_vault
    await program.methods
      .initializeVault()
      .accounts({
        user: user.publicKey,
        vault: vaultPda,
        vaultTokenAccount: expectedVaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Fetch and assert vault state
    const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
    expect(vaultAcc.owner.toBase58()).to.eq(user.publicKey.toBase58());
    expect(vaultAcc.usdtMint.toBase58()).to.eq(usdtMint.toBase58());
    expect(vaultAcc.tokenAccount.toBase58()).to.eq(expectedVaultAta.toBase58());
    expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(0);
    expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(0);
    expect(new BN(vaultAcc.lockedBalance).toNumber()).to.eq(0);

    // Assert the ATA exists
    const ataInfo = await getAccount(connection, expectedVaultAta);
    expect(ataInfo.mint.toBase58()).to.eq(usdtMint.toBase58());
    expect(ataInfo.owner.toBase58()).to.eq(vaultPda.toBase58());

    // Re-running initialize_vault should fail (already initialized)
    let threw = false;
    try {
      await program.methods
        .initializeVault()
        .accounts({
          user: user.publicKey,
          vault: vaultPda,
          vaultTokenAccount: expectedVaultAta,
          usdtMint,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });
});
