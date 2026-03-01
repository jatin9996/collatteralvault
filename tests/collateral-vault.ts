import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { CollateralVault } from "../target/types/collateral_vault";
import { MockPositionManager } from "../target/types/mock_position_manager";
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
  const mockProgram = anchor.workspace.mockPositionManager as Program<MockPositionManager>;
  const [vaultAuthorityPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

  const ensureVaultAuthority = async (
    authorizedPrograms: web3.PublicKey[] = [],
    options: { cpiEnforced?: boolean } = {}
  ) => {
    const governance = provider.wallet as anchor.Wallet;
    let va: any;
    try {
      va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    } catch (_) {
      await program.methods
        .initializeVaultAuthority(authorizedPrograms, false)
        .accountsPartial({
          governance: governance.publicKey,
          vaultAuthority: vaultAuthorityPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    }

    const desired = new Set(authorizedPrograms.map((p) => p.toBase58()));
    const current = new Set((va.authorizedPrograms as web3.PublicKey[]).map((p) => p.toBase58()));

    for (const existing of current) {
      if (!desired.has(existing)) {
        await (program as any).methods
          .removeAuthorizedProgram(new web3.PublicKey(existing))
          .accountsPartial({
            governance: governance.publicKey,
            vaultAuthority: vaultAuthorityPda,
          })
          .rpc();
      }
    }

    for (const want of desired) {
      if (!current.has(want)) {
        await (program as any).methods
          .addAuthorizedProgram(new web3.PublicKey(want))
          .accountsPartial({
            governance: governance.publicKey,
            vaultAuthority: vaultAuthorityPda,
          })
          .rpc();
      }
    }

    if (options.cpiEnforced !== undefined) {
      const refreshed = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
      if (refreshed.cpiEnforced !== options.cpiEnforced) {
        await (program as any).methods
          .setCpiEnforced(options.cpiEnforced)
          .accountsPartial({
            governance: governance.publicKey,
            vaultAuthority: vaultAuthorityPda,
          })
          .rpc();
      }
    }
  };

  const ensurePositionSummary = async (vault: web3.PublicKey, payer: web3.Keypair) => {
    const [summaryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vault.toBuffer()],
      mockProgram.programId
    );
    try {
      await mockProgram.account.positionSummaryAccount.fetch(summaryPda);
    } catch (_) {
      await mockProgram.methods
        .initPositionSummary()
        .accounts({
          payer: payer.publicKey,
          vault,
          positionSummary: summaryPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    }
    return summaryPda;
  };

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

  it("withdraw transfers tokens and updates vault state", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    await ensureVaultAuthority([]);

    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      owner.publicKey
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      ownerAta.address,
      user.publicKey,
      1_000_000n // 1.0 USDT
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    // Deposit 0.6, then withdraw 0.2
    await program.methods
      .deposit(new BN(600_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        userTokenAccount: ownerAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    await (program as any).methods
      .withdraw(new BN(200_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultAta,
        userTokenAccount: ownerAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const ownerAtaInfo = await getAccount(connection, ownerAta.address);
    const vaultAtaInfo = await getAccount(connection, vaultAta);
    expect(Number(ownerAtaInfo.amount)).to.eq(600_000); // 1_000_000 - 600_000 + 200_000
    expect(Number(vaultAtaInfo.amount)).to.eq(400_000); // 600_000 - 200_000

    const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
    expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(400_000);
    expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(400_000);
    expect(new BN(vaultAcc.totalWithdrawn).toNumber()).to.eq(200_000);
    expect(new BN(vaultAcc.totalDeposited).toNumber()).to.eq(600_000);
  });

  it("withdraw fails when amount exceeds available", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    await ensureVaultAuthority([]);

    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      owner.publicKey
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      ownerAta.address,
      user.publicKey,
      300_000n
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .deposit(new BN(200_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        userTokenAccount: ownerAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    let threw = false;
    try {
      await (program as any).methods
        .withdraw(new BN(250_000))
        .accountsPartial({
          user: owner.publicKey,
          vault: vaultPda,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: vaultAta,
          userTokenAccount: ownerAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("unauthorized user cannot withdraw from another user's vault", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    await ensureVaultAuthority([]);

    const alice = web3.Keypair.generate();
    const bob = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    await connection.confirmTransaction(
      await connection.requestAirdrop(bob.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6
    );

    const aliceAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      alice.publicKey
    );
    const bobAta = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      bob.publicKey
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      aliceAta.address,
      user.publicKey,
      500_000n
    );

    const [aliceVaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const aliceVaultAta = await getAssociatedTokenAddress(usdtMint, aliceVaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        vaultTokenAccount: aliceVaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deposit(new BN(200_000))
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: aliceVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    // Bob attempts to withdraw from Alice's vault
    let threw = false;
    try {
      await (program as any).methods
        .withdraw(new BN(50_000))
        .accountsPartial({
          user: bob.publicKey,
          vault: aliceVaultPda,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: aliceVaultAta,
          userTokenAccount: bobAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([bob])
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("withdraw requires position summary when authorized programs exist", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    await ensureVaultAuthority([mockProgram.programId]);

    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );
    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      usdtMint,
      owner.publicKey
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      ownerAta.address,
      user.publicKey,
      500_000n
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .deposit(new BN(300_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        userTokenAccount: ownerAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const summaryPda = await ensurePositionSummary(vaultPda, owner);

    let missingSummaryThrew = false;
    try {
      await (program as any).methods
        .withdraw(new BN(100_000))
        .accountsPartial({
          user: owner.publicKey,
          vault: vaultPda,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: vaultAta,
          userTokenAccount: ownerAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
    } catch (err) {
      missingSummaryThrew = true;
      const anchorErr = err as anchor.AnchorError;
      if (anchorErr?.error?.errorCode?.number !== undefined) {
        expect(anchorErr.error.errorCode.number).to.eq(6015);
      }
    }
    expect(missingSummaryThrew).to.eq(true);

    await (program as any).methods
      .withdraw(new BN(100_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultAta,
        userTokenAccount: ownerAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: summaryPda,
          isWritable: false,
          isSigner: false,
        },
      ])
      .signers([owner])
      .rpc();

    const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
    expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(200_000);
  });

  it("initialize_vault_authority sets governance, programs, and freeze", async () => {
    const user = provider.wallet as anchor.Wallet;

    const initialPrograms = [
      web3.Keypair.generate().publicKey,
      web3.Keypair.generate().publicKey,
    ];

    await ensureVaultAuthority(initialPrograms, { cpiEnforced: false });

    const va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    expect(va.governance.toBase58()).to.eq(user.publicKey.toBase58());
    expect(va.authorizedPrograms.length).to.eq(initialPrograms.length);
    expect(va.freeze).to.eq(false);
  });

  it("only governance can update vault authority and add/remove works", async () => {
    const user = provider.wallet as anchor.Wallet;

    await ensureVaultAuthority([]);

    // Add a new program
    const newProgram = web3.Keypair.generate().publicKey;
    await (program as any).methods
      .addAuthorizedProgram(newProgram)
      .accountsPartial({
        governance: user.publicKey,
        vaultAuthority: vaultAuthorityPda,
      })
      .rpc();

    let va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    expect(va.authorizedPrograms.map((p: web3.PublicKey) => p.toBase58())).to.include(
      newProgram.toBase58()
    );

    // Duplicate add should throw
    let dupThrew = false;
    try {
      await (program as any).methods
        .addAuthorizedProgram(newProgram)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaultAuthorityPda,
        })
        .rpc();
    } catch (e) {
      dupThrew = true;
    }
    expect(dupThrew).to.eq(true);

    // Remove an existing program
    const toRemove = va.authorizedPrograms[0] as web3.PublicKey;
    await (program as any).methods
      .removeAuthorizedProgram(toRemove)
      .accountsPartial({
        governance: user.publicKey,
        vaultAuthority: vaultAuthorityPda,
      })
      .rpc();

    va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    expect(va.authorizedPrograms.map((p: web3.PublicKey) => p.toBase58())).to.not.include(
      toRemove.toBase58()
    );

    // Non-governance signer cannot update
    const attacker = web3.Keypair.generate();
    let unauthorizedThrew = false;
    try {
      await (program as any).methods
        .addAuthorizedProgram(web3.Keypair.generate().publicKey)
        .accountsPartial({
          governance: attacker.publicKey,
          vaultAuthority: vaultAuthorityPda,
        })
        .signers([attacker])
        .rpc();
    } catch (e) {
      unauthorizedThrew = true;
    }
    expect(unauthorizedThrew).to.eq(true);
  });

  it("set_freeze_flag toggles freeze on vault authority", async () => {
    const user = provider.wallet as anchor.Wallet;

    await ensureVaultAuthority([]);

    await (program as any).methods
      .setFreezeFlag(true)
      .accountsPartial({
        governance: user.publicKey,
        vaultAuthority: vaultAuthorityPda,
      })
      .rpc();

    let va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    expect(va.freeze).to.eq(true);

    await (program as any).methods
      .setFreezeFlag(false)
      .accountsPartial({
        governance: user.publicKey,
        vaultAuthority: vaultAuthorityPda,
      })
      .rpc();

    va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    expect(va.freeze).to.eq(false);
  });

  it("lock_collateral and unlock_collateral adjust balances (accounting only)", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    await ensureVaultAuthority([mockProgram.programId]);

    // Fresh owner and mint
    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );

    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      usdtMint,
      owner.publicKey
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      ownerAta.address,
      user.publicKey,
      1_000_000n
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    // Deposit 0.5 USDT
    await program.methods
      .deposit(new BN(500_000))
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        userTokenAccount: ownerAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const summaryPda = await ensurePositionSummary(vaultPda, owner);

    // Lock 0.2 via CPI
    await mockProgram.methods
      .openPosition(new BN(200_000))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    let vaultAcc = await program.account.collateralVault.fetch(vaultPda);
    expect(new BN(vaultAcc.lockedBalance).toNumber()).to.eq(200_000);
    expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(300_000);
    expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(500_000);

    // Unlock 0.1 via CPI
    await mockProgram.methods
      .closePosition(new BN(100_000))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    vaultAcc = await program.account.collateralVault.fetch(vaultPda);
    expect(new BN(vaultAcc.lockedBalance).toNumber()).to.eq(100_000);
    expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(400_000);
    expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(500_000);
  });

  it("lock_collateral fails for unauthorized caller program", async () => {
    const user = provider.wallet as anchor.Wallet;

    // Authorized list is empty; we'll try to lock with a random program key
    const rogueCaller = web3.Keypair.generate().publicKey;

    await ensureVaultAuthority([]);

    // Fresh owner/vault (no deposit needed to assert UnauthorizedProgram first)
    const owner = web3.Keypair.generate();
    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );

    // Create minimal vault state (init only)
    const connection = provider.connection;
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    const usdtMint = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);
    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    let threw = false;
    try {
      await (program as any).methods
        .lockCollateral(new BN(1))
        .accountsPartial({
          callerProgram: rogueCaller,
          vaultAuthority: vaultAuthorityPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          vault: vaultPda,
        })
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("transfer_collateral moves tokens between vaults and updates both states", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    await ensureVaultAuthority([mockProgram.programId]);

    // Create mint and two users
    const alice = web3.Keypair.generate();
    const bob = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    await connection.confirmTransaction(
      await connection.requestAirdrop(bob.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );

    const aliceAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      usdtMint,
      alice.publicKey
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      aliceAta.address,
      user.publicKey,
      1_000_000n
    );

    // Compute PDAs and ATAs for both vaults
    const [aliceVaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const [bobVaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), bob.publicKey.toBuffer()],
      program.programId
    );
    const aliceVaultAta = await getAssociatedTokenAddress(usdtMint, aliceVaultPda, true);
    const bobVaultAta = await getAssociatedTokenAddress(usdtMint, bobVaultPda, true);

    // Initialize both vaults
    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        vaultTokenAccount: aliceVaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: bob.publicKey,
        vault: bobVaultPda,
        vaultTokenAccount: bobVaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bob])
      .rpc();

    // Alice deposits 0.6 USDT
    await program.methods
      .deposit(new BN(600_000))
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: aliceVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    // Transfer 0.2 from Alice's vault to Bob's vault via authorized caller
    await mockProgram.methods
      .rebalanceCollateral(new BN(200_000))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        fromVault: aliceVaultPda,
        toVault: bobVaultPda,
        fromVaultTokenAccount: aliceVaultAta,
        toVaultTokenAccount: bobVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    // Assert SPL balances
    const aliceVaultAtaInfo = await getAccount(connection, aliceVaultAta);
    const bobVaultAtaInfo = await getAccount(connection, bobVaultAta);
    expect(Number(aliceVaultAtaInfo.amount)).to.eq(400_000);
    expect(Number(bobVaultAtaInfo.amount)).to.eq(200_000);

    // Assert vault state
    const aliceVaultAcc = await program.account.collateralVault.fetch(aliceVaultPda);
    const bobVaultAcc = await program.account.collateralVault.fetch(bobVaultPda);
    expect(new BN(aliceVaultAcc.totalBalance).toNumber()).to.eq(400_000);
    expect(new BN(aliceVaultAcc.availableBalance).toNumber()).to.eq(400_000);
    expect(new BN(aliceVaultAcc.lockedBalance).toNumber()).to.eq(0);
    expect(new BN(bobVaultAcc.totalBalance).toNumber()).to.eq(200_000);
    expect(new BN(bobVaultAcc.availableBalance).toNumber()).to.eq(200_000);
    expect(new BN(bobVaultAcc.lockedBalance).toNumber()).to.eq(0);
  });

  it("transfer_collateral fails for unauthorized caller program", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    // Rogue caller not in allowlist
    const rogueCaller = web3.Keypair.generate().publicKey;

    await ensureVaultAuthority([]);

    // Setup minimal two vaults and mint
    const alice = web3.Keypair.generate();
    const bob = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    await connection.confirmTransaction(
      await connection.requestAirdrop(bob.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );
    const [aliceVaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const [bobVaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), bob.publicKey.toBuffer()],
      program.programId
    );
    const aliceVaultAta = await getAssociatedTokenAddress(usdtMint, aliceVaultPda, true);
    const bobVaultAta = await getAssociatedTokenAddress(usdtMint, bobVaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        vaultTokenAccount: aliceVaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: bob.publicKey,
        vault: bobVaultPda,
        vaultTokenAccount: bobVaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bob])
      .rpc();

    // To fail fast on UnauthorizedProgram, no deposit is strictly necessary, but
    // deposit a small amount so follow-up checks wouldn't pass otherwise.
    const aliceAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      usdtMint,
      alice.publicKey
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      aliceAta.address,
      user.publicKey,
      100_000n
    );
    await program.methods
      .deposit(new BN(50_000))
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: aliceVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    let threw = false;
    try {
      await mockProgram.methods
        .rebalanceCollateral(new BN(10_000))
        .accounts({
          callerProgram: rogueCaller,
          vaultAuthority: vaultAuthorityPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          fromVault: aliceVaultPda,
          toVault: bobVaultPda,
          fromVaultTokenAccount: aliceVaultAta,
          toVaultTokenAccount: bobVaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          collateralVaultProgram: program.programId,
        })
        .rpc();
    } catch (e) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });
});
