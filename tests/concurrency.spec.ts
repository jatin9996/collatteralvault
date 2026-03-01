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

describe("concurrency simulation: parallel deposits and withdraws", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.collateralVault as Program<CollateralVault>;

  it("parallel deposits aggregate correctly, parallel withdraws preserve invariants", async () => {
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

    // fund 10 USDT
    await mintTo(connection, (user as any).payer, mint, ownerAta.address, user.publicKey, 10_000_000n);

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

    // 8 parallel deposits of varying sizes (sum = 4.5 USDT)
    const deposits = [
      100_000,
      200_000,
      300_000,
      400_000,
      500_000,
      600_000,
      700_000,
      1_700_000,
    ];

    await Promise.all(
      deposits.map((d) =>
        program.methods
          .deposit(new BN(d))
          .accountsPartial({
            user: owner.publicKey,
            vault: vaultPda,
            userTokenAccount: ownerAta.address,
            vaultTokenAccount: vaultAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc()
      )
    );

    const vaultAfterDeposits = await program.account.collateralVault.fetch(vaultPda);
    const totalDeposited = deposits.reduce((a, b) => a + b, 0);
    expect(Number(vaultAfterDeposits.totalBalance)).to.eq(totalDeposited);
    expect(Number(vaultAfterDeposits.availableBalance)).to.eq(totalDeposited);

    // Now attempt 6 parallel withdraws; some may fail if we oversubscribe
    const withdraws = [200_000, 800_000, 1_500_000, 1_000_000, 600_000, 800_000];
    const results = await Promise.allSettled(
      withdraws.map((w) =>
        (program as any).methods
          .withdraw(new BN(w))
          .accountsPartial({
            user: owner.publicKey,
            vault: vaultPda,
            vaultTokenAccount: vaultAta,
            userTokenAccount: ownerAta.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc()
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).to.be.greaterThan(0);

    // Sum successful withdraws and verify final balances are consistent
    const successfulSum = results.reduce((acc, r, i) => {
      if (r.status === "fulfilled") return acc + withdraws[i];
      return acc;
    }, 0);

    const v = await program.account.collateralVault.fetch(vaultPda);
    expect(Number(v.totalBalance)).to.eq(totalDeposited - successfulSum);
    expect(Number(v.availableBalance)).to.eq(totalDeposited - successfulSum);
  });
});


