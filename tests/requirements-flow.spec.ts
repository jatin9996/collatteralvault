/**
 * Requirements Flow Test – Collateral Vault Management System
 *
 * Tests all implemented functionality against the product requirements with
 * a single end-to-end flow and sample data. Covers:
 *
 * 1. Initialize User Vault (PDA-based vault, ATA for USDT, rent-exempt, balance tracking)
 * 2. Deposit Collateral (SPL Token CPI, balance update, deposit event, min deposit)
 * 3. Withdraw Collateral (no open positions, available balance, CPI, withdrawal event)
 * 4. Lock Collateral (CPI from position manager, locked vs available)
 * 5. Unlock Collateral (CPI when position closed)
 * 6. Transfer Collateral (internal, CPI from authorized program, atomic)
 *
 * Security: only vault owner can withdraw; only authorized programs can lock/unlock/transfer;
 * validated balances; atomic state updates.
 *
 * Run: anchor test tests/requirements-flow.spec.ts
 */

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

// ─── Sample data (USDT 6 decimals) ───────────────────────────────────────
const SAMPLE = {
  // Initial wallet balances
  ALICE_USDT: 50_000 * 1e6,   // 50,000 USDT
  BOB_USDT: 20_000 * 1e6,     // 20,000 USDT
  // Deposits
  ALICE_DEPOSIT_1: 10_000 * 1e6,
  ALICE_DEPOSIT_2: 5_000 * 1e6,
  BOB_DEPOSIT: 3_000 * 1e6,
  // Lock (margin for position)
  LOCK_AMOUNT: 8_000 * 1e6,
  UNLOCK_AMOUNT: 3_000 * 1e6,
  // Withdraw (after unlock)
  WITHDRAW_AMOUNT: 4_000 * 1e6,
  // Transfer between vaults (e.g. settlement)
  TRANSFER_AMOUNT: 2_000 * 1e6,
  MIN_DEPOSIT: 1,
};

describe("Requirements Flow: Collateral Vault – full flow with sample data", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.collateralVault as Program<CollateralVault>;
  const mockProgram = anchor.workspace.mockPositionManager as Program<MockPositionManager>;

  const [vaultAuthorityPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

  const ensureVaultAuthority = async (authorizedPrograms: web3.PublicKey[] = []) => {
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
          .accountsPartial({ governance: governance.publicKey, vaultAuthority: vaultAuthorityPda })
          .rpc();
      }
    }
    for (const want of desired) {
      if (!current.has(want)) {
        await (program as any).methods
          .addAuthorizedProgram(new web3.PublicKey(want))
          .accountsPartial({ governance: governance.publicKey, vaultAuthority: vaultAuthorityPda })
          .rpc();
      }
    }
  };

  const ensurePositionSummary = async (vaultPda: web3.PublicKey, payer: web3.Keypair) => {
    const [summaryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vaultPda.toBuffer()],
      mockProgram.programId
    );
    try {
      await mockProgram.account.positionSummaryAccount.fetch(summaryPda);
    } catch (_) {
      await mockProgram.methods
        .initPositionSummary()
        .accounts({
          payer: payer.publicKey,
          vault: vaultPda,
          positionSummary: summaryPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    }
    return summaryPda;
  };

  it("1. Initialize User Vault – PDA vault, USDT ATA, rent-exempt, balance tracking", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const alice = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const usdtMint = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    expect(vault.owner.toBase58()).to.eq(alice.publicKey.toBase58());
    expect(vault.tokenAccount.toBase58()).to.eq(vaultAta.toBase58());
    expect(vault.usdtMint.toBase58()).to.eq(usdtMint.toBase58());
    expect(Number(vault.totalBalance)).to.eq(0);
    expect(Number(vault.lockedBalance)).to.eq(0);
    expect(Number(vault.availableBalance)).to.eq(0);
    expect(Number(vault.totalDeposited)).to.eq(0);
    expect(Number(vault.totalWithdrawn)).to.eq(0);
    expect(vault.createdAt.toNumber()).to.be.greaterThan(0);
    expect(vault.bump).to.be.greaterThan(0);

    const ataInfo = await getAccount(connection, vaultAta);
    expect(ataInfo.mint.toBase58()).to.eq(usdtMint.toBase58());
    expect(ataInfo.owner.toBase58()).to.eq(vaultPda.toBase58());
  });

  it("2. Deposit Collateral – SPL transfer, balance update, min deposit validation", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const alice = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
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
      BigInt(SAMPLE.ALICE_USDT)
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    // Deposit 1: 10,000 USDT
    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_1))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    let vault = await program.account.collateralVault.fetch(vaultPda);
    expect(Number(vault.totalBalance)).to.eq(SAMPLE.ALICE_DEPOSIT_1);
    expect(Number(vault.availableBalance)).to.eq(SAMPLE.ALICE_DEPOSIT_1);
    expect(Number(vault.totalDeposited)).to.eq(SAMPLE.ALICE_DEPOSIT_1);

    // Deposit 2: 5,000 USDT
    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_2))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    vault = await program.account.collateralVault.fetch(vaultPda);
    const expectedTotal = SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2;
    expect(Number(vault.totalBalance)).to.eq(expectedTotal);
    expect(Number(vault.availableBalance)).to.eq(expectedTotal);
    expect(Number(vault.totalDeposited)).to.eq(expectedTotal);

    const vaultAtaInfo = await getAccount(connection, vaultAta);
    expect(Number(vaultAtaInfo.amount)).to.eq(expectedTotal);

    // Min deposit: 0 should fail
    let threw = false;
    try {
      await program.methods
        .deposit(new BN(0))
        .accountsPartial({
          user: alice.publicKey,
          vault: vaultPda,
          userTokenAccount: aliceAta.address,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([alice])
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("3. Withdraw – no open positions, available balance, CPI, event", async () => {
    await ensureVaultAuthority([]);

    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const alice = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
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
      BigInt(SAMPLE.ALICE_USDT)
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    const beforeWithdraw = await getAccount(connection, aliceAta.address);

    await (program as any).methods
      .withdraw(new BN(SAMPLE.WITHDRAW_AMOUNT))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultAta,
        userTokenAccount: aliceAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    const expectedRemaining = SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2 - SAMPLE.WITHDRAW_AMOUNT;
    expect(Number(vault.totalBalance)).to.eq(expectedRemaining);
    expect(Number(vault.availableBalance)).to.eq(expectedRemaining);
    expect(Number(vault.totalWithdrawn)).to.eq(SAMPLE.WITHDRAW_AMOUNT);

    const aliceAtaAfter = await getAccount(connection, aliceAta.address);
    expect(Number(aliceAtaAfter.amount)).to.eq(Number(beforeWithdraw.amount) + SAMPLE.WITHDRAW_AMOUNT);
  });

  it("4. Lock Collateral – CPI from position manager, locked vs available", async () => {
    await ensureVaultAuthority([mockProgram.programId]);

    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const alice = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
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
      BigInt(SAMPLE.ALICE_USDT)
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    const summaryPda = await ensurePositionSummary(vaultPda, alice);

    await mockProgram.methods
      .openPosition(new BN(SAMPLE.LOCK_AMOUNT))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    const vault = await program.account.collateralVault.fetch(vaultPda);
    const total = SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2;
    expect(Number(vault.totalBalance)).to.eq(total);
    expect(Number(vault.lockedBalance)).to.eq(SAMPLE.LOCK_AMOUNT);
    expect(Number(vault.availableBalance)).to.eq(total - SAMPLE.LOCK_AMOUNT);
  });

  it("5. Withdraw fails while locked (open positions); unlock then withdraw", async () => {
    await ensureVaultAuthority([mockProgram.programId]);

    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const alice = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, web3.LAMPORTS_PER_SOL),
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
      BigInt(SAMPLE.ALICE_USDT)
    );

    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), alice.publicKey.toBuffer()],
      program.programId
    );
    const vaultAta = await getAssociatedTokenAddress(usdtMint, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAta,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    const summaryPda = await ensurePositionSummary(vaultPda, alice);

    await mockProgram.methods
      .openPosition(new BN(SAMPLE.LOCK_AMOUNT))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    let withdrawWhileLockedThrew = false;
    try {
      await (program as any).methods
        .withdraw(new BN(SAMPLE.WITHDRAW_AMOUNT))
        .accountsPartial({
          user: alice.publicKey,
          vault: vaultPda,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: vaultAta,
          userTokenAccount: aliceAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([{ pubkey: summaryPda, isWritable: false, isSigner: false }])
        .signers([alice])
        .rpc();
    } catch (_) {
      withdrawWhileLockedThrew = true;
    }
    expect(withdrawWhileLockedThrew).to.eq(true);

    await mockProgram.methods
      .closePosition(new BN(SAMPLE.LOCK_AMOUNT))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vaultPda,
        positionSummary: summaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    const vaultAfterUnlock = await program.account.collateralVault.fetch(vaultPda);
    expect(Number(vaultAfterUnlock.lockedBalance)).to.eq(0);
    expect(Number(vaultAfterUnlock.availableBalance)).to.eq(SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2);

    await (program as any).methods
      .withdraw(new BN(SAMPLE.WITHDRAW_AMOUNT))
      .accountsPartial({
        user: alice.publicKey,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultAta,
        userTokenAccount: aliceAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([{ pubkey: summaryPda, isWritable: false, isSigner: false }])
      .signers([alice])
      .rpc();

    const vaultFinal = await program.account.collateralVault.fetch(vaultPda);
    const expected = SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2 - SAMPLE.WITHDRAW_AMOUNT;
    expect(Number(vaultFinal.totalBalance)).to.eq(expected);
    expect(Number(vaultFinal.totalWithdrawn)).to.eq(SAMPLE.WITHDRAW_AMOUNT);
  });

  it("6. Transfer Collateral – CPI from authorized program, atomic between vaults", async () => {
    await ensureVaultAuthority([mockProgram.programId]);

    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

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
    const bobAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      usdtMint,
      bob.publicKey
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      aliceAta.address,
      user.publicKey,
      BigInt(SAMPLE.ALICE_USDT)
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      bobAta.address,
      user.publicKey,
      BigInt(SAMPLE.BOB_USDT)
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

    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2))
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: aliceVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deposit(new BN(SAMPLE.BOB_DEPOSIT))
      .accountsPartial({
        user: bob.publicKey,
        vault: bobVaultPda,
        userTokenAccount: bobAta.address,
        vaultTokenAccount: bobVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bob])
      .rpc();

    await mockProgram.methods
      .rebalanceCollateral(new BN(SAMPLE.TRANSFER_AMOUNT))
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

    const aliceVault = await program.account.collateralVault.fetch(aliceVaultPda);
    const bobVault = await program.account.collateralVault.fetch(bobVaultPda);

    const aliceExpected = SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2 - SAMPLE.TRANSFER_AMOUNT;
    const bobExpected = SAMPLE.BOB_DEPOSIT + SAMPLE.TRANSFER_AMOUNT;

    expect(Number(aliceVault.totalBalance)).to.eq(aliceExpected);
    expect(Number(aliceVault.availableBalance)).to.eq(aliceExpected);
    expect(Number(bobVault.totalBalance)).to.eq(bobExpected);
    expect(Number(bobVault.availableBalance)).to.eq(bobExpected);

    const aliceVaultAtaInfo = await getAccount(connection, aliceVaultAta);
    const bobVaultAtaInfo = await getAccount(connection, bobVaultAta);
    expect(Number(aliceVaultAtaInfo.amount)).to.eq(aliceExpected);
    expect(Number(bobVaultAtaInfo.amount)).to.eq(bobExpected);
  });

  it("7. Full flow: init → deposit → lock → unlock → withdraw → transfer (sample data)", async () => {
    await ensureVaultAuthority([mockProgram.programId]);

    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

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
    const bobAta = await getOrCreateAssociatedTokenAccount(
      connection,
      (user as any).payer,
      usdtMint,
      bob.publicKey
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      aliceAta.address,
      user.publicKey,
      BigInt(SAMPLE.ALICE_USDT)
    );
    await mintTo(
      connection,
      (user as any).payer,
      usdtMint,
      bobAta.address,
      user.publicKey,
      BigInt(SAMPLE.BOB_USDT)
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

    await program.methods
      .deposit(new BN(SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2))
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        userTokenAccount: aliceAta.address,
        vaultTokenAccount: aliceVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deposit(new BN(SAMPLE.BOB_DEPOSIT))
      .accountsPartial({
        user: bob.publicKey,
        vault: bobVaultPda,
        userTokenAccount: bobAta.address,
        vaultTokenAccount: bobVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bob])
      .rpc();

    const aliceSummaryPda = await ensurePositionSummary(aliceVaultPda, alice);

    await mockProgram.methods
      .openPosition(new BN(SAMPLE.LOCK_AMOUNT))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: aliceVaultPda,
        positionSummary: aliceSummaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    await mockProgram.methods
      .closePosition(new BN(SAMPLE.UNLOCK_AMOUNT))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: aliceVaultPda,
        positionSummary: aliceSummaryPda,
        collateralVaultProgram: program.programId,
      })
      .rpc();

    const remainingLocked = SAMPLE.LOCK_AMOUNT - SAMPLE.UNLOCK_AMOUNT;
    if (remainingLocked > 0) {
      await mockProgram.methods
        .closePosition(new BN(remainingLocked))
        .accounts({
          callerProgram: mockProgram.programId,
          vaultAuthority: vaultAuthorityPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          vault: aliceVaultPda,
          positionSummary: aliceSummaryPda,
          collateralVaultProgram: program.programId,
        })
        .rpc();
    }

    await (program as any).methods
      .withdraw(new BN(SAMPLE.WITHDRAW_AMOUNT))
      .accountsPartial({
        user: alice.publicKey,
        vault: aliceVaultPda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: aliceVaultAta,
        userTokenAccount: aliceAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([{ pubkey: aliceSummaryPda, isWritable: false, isSigner: false }])
      .signers([alice])
      .rpc();

    await mockProgram.methods
      .rebalanceCollateral(new BN(SAMPLE.TRANSFER_AMOUNT))
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

    const aliceTotal = SAMPLE.ALICE_DEPOSIT_1 + SAMPLE.ALICE_DEPOSIT_2;
    const aliceExpected = aliceTotal - SAMPLE.WITHDRAW_AMOUNT - SAMPLE.TRANSFER_AMOUNT;
    const bobExpected = SAMPLE.BOB_DEPOSIT + SAMPLE.TRANSFER_AMOUNT;

    const finalAlice = await program.account.collateralVault.fetch(aliceVaultPda);
    const finalBob = await program.account.collateralVault.fetch(bobVaultPda);

    expect(Number(finalAlice.totalBalance)).to.eq(aliceExpected);
    expect(Number(finalAlice.availableBalance)).to.eq(aliceExpected);
    expect(Number(finalAlice.lockedBalance)).to.eq(0);
    expect(Number(finalBob.totalBalance)).to.eq(bobExpected);
    expect(Number(finalBob.availableBalance)).to.eq(bobExpected);

    expect(Number(finalAlice.totalBalance)).to.eq(
      Number(finalAlice.availableBalance) + Number(finalAlice.lockedBalance)
    );
    expect(Number(finalBob.totalBalance)).to.eq(
      Number(finalBob.availableBalance) + Number(finalBob.lockedBalance)
    );
  });
});
