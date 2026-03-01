import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { CollateralVault } from "../target/types/collateral_vault";

describe("fuzzing invalid inputs", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.collateralVault as Program<CollateralVault>;

  it("random zero/oversized deposit and withdraw attempts fail", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const mint = await createMint(connection, (user as any).payer, user.publicKey, null, 6);
    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      mint,
      owner.publicKey
    );
    await mintTo(connection, (user as any).payer, mint, ownerAta.address, user.publicKey, 1_000_000n);

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint: mint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    // Fuzz: a bunch of invalid deposits (0 or > balance)
    const invalidDeposits = [0, 2_000_000, 9_999_999_999];
    for (const d of invalidDeposits) {
      let threw = false;
      try {
        await program.methods
          .deposit(new BN(d))
          .accountsPartial({
            user: owner.publicKey,
            vault: vaultPda,
            userTokenAccount: ownerAta.address,
            vaultTokenAccount: vaultAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    }

    // Make a small valid deposit
    await program.methods
      .deposit(new BN(100_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        userTokenAccount: ownerAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    // Fuzz: invalid withdraws (0, more than available)
    const invalidWithdraws = [0, 200_000, 10_000_000_000];
    for (const w of invalidWithdraws) {
      let threw = false;
      try {
        await (program as any).methods
          .withdraw(new BN(w))
          .accountsPartial({
            user: owner.publicKey,
            vault: vaultPda,
            vaultTokenAccount: vaultAta,
            userTokenAccount: ownerAta.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    }
  });

  it("mismatched token account mint on deposit is rejected", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // vault mint A
    const mintA = await createMint(connection, (user as any).payer, user.publicKey, null, 6);
    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mintA, vaultPda, true);
    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint: mintA,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    // user ATA with mint B
    const mintB = await createMint(connection, (user as any).payer, user.publicKey, null, 6);
    const ownerAtaWrong = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      mintB,
      owner.publicKey
    );
    await mintTo(connection, (user as any).payer, mintB, ownerAtaWrong.address, user.publicKey, 1_000_000n);

    let threw = false;
    try {
      await program.methods
        .deposit(new BN(100_000))
        .accountsPartial({
          user: owner.publicKey,
          vault: vaultPda,
          userTokenAccount: ownerAtaWrong.address, // wrong mint
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });
});


