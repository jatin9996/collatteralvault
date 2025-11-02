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
      .accountsPartial({
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
        .accountsPartial({
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

  it("deposit transfers tokens and updates vault state", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    // Fresh user to isolate state
    const depositor = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(depositor.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Create a USDT mint (6 decimals), mint authority = provider wallet for convenience
    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    // Create depositor ATA and mint some tokens to them
    const depositorAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      depositor.publicKey
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      depositorAta.address,
      user.publicKey,
      1_000_000n // 1.0 USDT (6 decimals)
    );

    // Compute expected Vault PDA and ATA
    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), depositor.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    // Initialize vault for depositor
    await program.methods
      .initializeVault()
      .accountsPartial({
        user: depositor.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([depositor])
      .rpc();

    // Deposit 0.3 USDT
    const amount = new BN(300_000); // 0.3 with 6 decimals
    await program.methods
      .deposit(amount)
      .accountsPartial({
        user: depositor.publicKey,
        vault: vaultPda,
        userTokenAccount: depositorAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    // Check on-chain SPL balances
    const depositorAtaInfo = await getAccount(connection, depositorAta.address);
    const vaultAtaInfo = await getAccount(connection, vaultAta);
    expect(Number(depositorAtaInfo.amount)).to.eq(700_000);
    expect(Number(vaultAtaInfo.amount)).to.eq(300_000);

    // Check vault state
    const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
    expect(vaultAcc.owner.toBase58()).to.eq(depositor.publicKey.toBase58());
    expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(300_000);
    expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(300_000);
    expect(new BN(vaultAcc.totalDeposited).toNumber()).to.eq(300_000);
  });

  it("deposit amount == 0 fails with InvalidAmount", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const depositor = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(depositor.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    const depositorAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      depositor.publicKey
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      depositorAta.address,
      user.publicKey,
      500_000n
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), depositor.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: depositor.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([depositor])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .deposit(new BN(0))
        .accountsPartial({
          user: depositor.publicKey,
          vault: vaultPda,
          userTokenAccount: depositorAta.address,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("deposit fails when user has insufficient funds", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const depositor = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(depositor.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    const depositorAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      depositor.publicKey
    );
    // Mint less than we will try to deposit
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      depositorAta.address,
      user.publicKey,
      100_000n // 0.1 USDT
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), depositor.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: depositor.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([depositor])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .deposit(new BN(200_000)) // 0.2 USDT > 0.1 balance
        .accountsPartial({
          user: depositor.publicKey,
          vault: vaultPda,
          userTokenAccount: depositorAta.address,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });
});
