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
  getAccount,
} from "@solana/spl-token";
import { CollateralVault } from "../target/types/collateral_vault";
import { MockPositionManager } from "../target/types/mock_position_manager";

describe("CPI: mock-position-manager open/close position with CPI enforcement", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const vaultProgram = anchor.workspace.collateralVault as Program<CollateralVault>;
  const mockProgram = anchor.workspace.mockPositionManager as Program<MockPositionManager>;

  it("lock/unlock via CPI succeeds when authorized and cpi_enforced=true", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    // Ensure VaultAuthority exists, include mock program id, and enable CPI enforcement
    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      vaultProgram.programId
    );

    try {
      await vaultProgram.methods
        .initializeVaultAuthority([mockProgram.programId], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      const va = await vaultProgram.account.vaultAuthority.fetch(vaPda);
      const present = (va.authorizedPrograms as web3.PublicKey[]).some(
        (p) => p.toBase58() === mockProgram.programId.toBase58()
      );
      if (!present) {
        await (vaultProgram as any).methods
          .addAuthorizedProgram(mockProgram.programId)
          .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
          .rpc();
      }
    }

    await (vaultProgram as any).methods
      .setCpiEnforced(true)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();

    // Setup owner + mint + vault
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
      vaultProgram.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mint, vaultPda, true);
    const [summaryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultPda.toBuffer()],
      mockProgram.programId
    );

    await vaultProgram.methods
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

    await vaultProgram.methods
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

    await mockProgram.methods
      .initPositionSummary()
      .accounts({
        payer: owner.publicKey,
        vault: vaultPda,
        positionSummary: summaryPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // CPI: open position (lock 0.2)
    await mockProgram.methods
      .openPosition(new BN(200_000))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: vaultProgram.programId,
      })
      .rpc();

    let v = await vaultProgram.account.collateralVault.fetch(vaultPda);
    expect(Number(v.lockedBalance)).to.eq(200_000);
    expect(Number(v.availableBalance)).to.eq(300_000);

    // CPI: close position (unlock 0.2)
    await mockProgram.methods
      .closePosition(new BN(200_000))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: vaultProgram.programId,
      })
      .rpc();

    v = await vaultProgram.account.collateralVault.fetch(vaultPda);
    expect(Number(v.lockedBalance)).to.eq(0);
    expect(Number(v.availableBalance)).to.eq(500_000);
  });

  it("CPI fails when mock program not authorized", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      vaultProgram.programId
    );

    // Clear authorized programs list
    let exists = false;
    try {
      await vaultProgram.account.vaultAuthority.fetch(vaPda);
      exists = true;
    } catch (_) {}
    if (!exists) {
      await vaultProgram.methods
        .initializeVaultAuthority([], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } else {
      const va = await vaultProgram.account.vaultAuthority.fetch(vaPda);
      for (const p of va.authorizedPrograms as web3.PublicKey[]) {
        await (vaultProgram as any).methods
          .removeAuthorizedProgram(p)
          .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
          .rpc();
      }
    }

    // Minimal owner+vault init
    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    const mint = await createMint(connection, (user as any).payer, user.publicKey, null, 6);
    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      vaultProgram.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mint, vaultPda, true);
    const [summaryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultPda.toBuffer()],
      mockProgram.programId
    );
    await vaultProgram.methods
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

    await mockProgram.methods
      .initPositionSummary()
      .accounts({
        payer: owner.publicKey,
        vault: vaultPda,
        positionSummary: summaryPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    let threw = false;
    try {
      await mockProgram.methods
        .openPosition(new BN(1))
        .accounts({
          callerProgram: mockProgram.programId,
          vaultAuthority: vaPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          vault: vaultPda,
          positionSummary: summaryPda,
          collateralVaultProgram: vaultProgram.programId,
        })
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("transfer_collateral via mock rebalance_collateral succeeds when authorized", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      vaultProgram.programId
    );

    try {
      await vaultProgram.methods
        .initializeVaultAuthority([mockProgram.programId], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      const va = await vaultProgram.account.vaultAuthority.fetch(vaPda);
      const present = (va.authorizedPrograms as web3.PublicKey[]).some(
        (p) => p.toBase58() === mockProgram.programId.toBase58()
      );
      if (!present) {
        await (vaultProgram as any).methods
          .addAuthorizedProgram(mockProgram.programId)
          .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
          .rpc();
      }
    }
    await (vaultProgram as any).methods
      .setCpiEnforced(true)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();

    const ownerA = web3.Keypair.generate();
    const ownerB = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(ownerA.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    await connection.confirmTransaction(
      await connection.requestAirdrop(ownerB.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    const mint = await createMint(connection, (user as any).payer, user.publicKey, null, 6);
    const ownerAata = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      mint,
      ownerA.publicKey
    );
    const ownerBata = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      mint,
      ownerB.publicKey
    );
    await mintTo(connection, (user as any).payer, mint, ownerAata.address, user.publicKey, 1_000_000n);
    await mintTo(connection, (user as any).payer, mint, ownerBata.address, user.publicKey, 500_000n);

    const [vaultAPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), ownerA.publicKey.toBuffer()],
      vaultProgram.programId
    );
    const [vaultBPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), ownerB.publicKey.toBuffer()],
      vaultProgram.programId
    );
    const vaultAata = await getAssociatedTokenAddress(mint, vaultAPda, true);
    const vaultBata = await getAssociatedTokenAddress(mint, vaultBPda, true);

    await vaultProgram.methods
      .initializeVault()
      .accountsPartial({
        user: ownerA.publicKey,
        vault: vaultAPda,
        vaultTokenAccount: vaultAata,
        usdtMint: mint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ownerA])
      .rpc();
    await vaultProgram.methods
      .initializeVault()
      .accountsPartial({
        user: ownerB.publicKey,
        vault: vaultBPda,
        vaultTokenAccount: vaultBata,
        usdtMint: mint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ownerB])
      .rpc();

    await vaultProgram.methods
      .deposit(new BN(400_000))
      .accountsPartial({
        user: ownerA.publicKey,
        vault: vaultAPda,
        userTokenAccount: ownerAata.address,
        vaultTokenAccount: vaultAata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ownerA])
      .rpc();
    await vaultProgram.methods
      .deposit(new BN(100_000))
      .accountsPartial({
        user: ownerB.publicKey,
        vault: vaultBPda,
        userTokenAccount: ownerBata.address,
        vaultTokenAccount: vaultBata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ownerB])
      .rpc();

    const [summaryAPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultAPda.toBuffer()],
      mockProgram.programId
    );
    const [summaryBPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultBPda.toBuffer()],
      mockProgram.programId
    );
    await mockProgram.methods
      .initPositionSummary()
      .accounts({
        payer: ownerA.publicKey,
        vault: vaultAPda,
        positionSummary: summaryAPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([ownerA])
      .rpc();
    await mockProgram.methods
      .initPositionSummary()
      .accounts({
        payer: ownerB.publicKey,
        vault: vaultBPda,
        positionSummary: summaryBPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([ownerB])
      .rpc();

    const transferAmount = new BN(50_000);
    await mockProgram.methods
      .rebalanceCollateral(transferAmount)
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        fromVault: vaultAPda,
        toVault: vaultBPda,
        fromVaultTokenAccount: vaultAata,
        toVaultTokenAccount: vaultBata,
        tokenProgram: TOKEN_PROGRAM_ID,
        collateralVaultProgram: vaultProgram.programId,
      })
      .rpc();

    const vA = await vaultProgram.account.collateralVault.fetch(vaultAPda);
    const vB = await vaultProgram.account.collateralVault.fetch(vaultBPda);
    expect(Number(vA.availableBalance)).to.eq(400_000 - 50_000);
    expect(Number(vA.totalBalance)).to.eq(350_000);
    expect(Number(vB.availableBalance)).to.eq(100_000 + 50_000);
    expect(Number(vB.totalBalance)).to.eq(150_000);
  });

  it("lock_collateral fails when vault authority is frozen", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      vaultProgram.programId
    );

    try {
      await vaultProgram.methods
        .initializeVaultAuthority([mockProgram.programId], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      const va = await vaultProgram.account.vaultAuthority.fetch(vaPda);
      const present = (va.authorizedPrograms as web3.PublicKey[]).some(
        (p) => p.toBase58() === mockProgram.programId.toBase58()
      );
      if (!present) {
        await (vaultProgram as any).methods
          .addAuthorizedProgram(mockProgram.programId)
          .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
          .rpc();
      }
    }
    await (vaultProgram as any).methods
      .setCpiEnforced(true)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();

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
      vaultProgram.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mint, vaultPda, true);
    const [summaryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultPda.toBuffer()],
      mockProgram.programId
    );

    await vaultProgram.methods
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
    await vaultProgram.methods
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
    await mockProgram.methods
      .initPositionSummary()
      .accounts({
        payer: owner.publicKey,
        vault: vaultPda,
        positionSummary: summaryPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await (vaultProgram as any).methods
      .setFreezeFlag(true)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();

    let threw = false;
    try {
      await mockProgram.methods
        .openPosition(new BN(100_000))
        .accounts({
          callerProgram: mockProgram.programId,
          vaultAuthority: vaPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          vault: vaultPda,
          positionSummary: summaryPda,
          collateralVaultProgram: vaultProgram.programId,
        })
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);

    await (vaultProgram as any).methods
      .setFreezeFlag(false)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();
  });

  it("unlock_collateral fails when vault authority is frozen", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      vaultProgram.programId
    );

    try {
      await vaultProgram.methods
        .initializeVaultAuthority([mockProgram.programId], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      const va = await vaultProgram.account.vaultAuthority.fetch(vaPda);
      const present = (va.authorizedPrograms as web3.PublicKey[]).some(
        (p) => p.toBase58() === mockProgram.programId.toBase58()
      );
      if (!present) {
        await (vaultProgram as any).methods
          .addAuthorizedProgram(mockProgram.programId)
          .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
          .rpc();
      }
    }
    await (vaultProgram as any).methods
      .setCpiEnforced(true)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();

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
      vaultProgram.programId
    );
    const vaultAta = await getAssociatedTokenAddress(mint, vaultPda, true);
    const [summaryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultPda.toBuffer()],
      mockProgram.programId
    );

    await vaultProgram.methods
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
    await vaultProgram.methods
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
    await mockProgram.methods
      .initPositionSummary()
      .accounts({
        payer: owner.publicKey,
        vault: vaultPda,
        positionSummary: summaryPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await mockProgram.methods
      .openPosition(new BN(200_000))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: vaultProgram.programId,
      })
      .rpc();

    await (vaultProgram as any).methods
      .setFreezeFlag(true)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();

    let threw = false;
    try {
      await mockProgram.methods
        .closePosition(new BN(200_000))
        .accounts({
          callerProgram: mockProgram.programId,
          vaultAuthority: vaPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          vault: vaultPda,
          positionSummary: summaryPda,
          collateralVaultProgram: vaultProgram.programId,
        })
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);

    await (vaultProgram as any).methods
      .setFreezeFlag(false)
      .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
      .rpc();
  });
});


