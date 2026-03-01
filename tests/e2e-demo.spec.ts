/**
 * End-to-End Demo Test with Sample Data
 * 
 * This test demonstrates the complete collateral vault lifecycle:
 * 1. Initialize Vault Authority
 * 2. Initialize User Vault
 * 3. Deposit Collateral
 * 4. Lock Collateral (via CPI)
 * 5. Unlock Collateral (via CPI)
 * 6. Withdraw Collateral
 * 7. Transfer Between Vaults
 * 
 * Run with: anchor test tests/e2e-demo.spec.ts
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

// Helper function to format token amounts (6 decimals)
const formatUSDT = (amount: BN | number): string => {
  const num = typeof amount === "number" ? amount : amount.toNumber();
  return (num / 1_000_000).toFixed(6) + " USDT";
};

// Helper function to print section headers
const printSection = (title: string) => {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
};

// Helper function to print vault state
const printVaultState = async (
  program: Program<CollateralVault>,
  vaultPda: web3.PublicKey,
  label: string
) => {
  try {
    const vault = await program.account.collateralVault.fetch(vaultPda);
    console.log(`\n📊 ${label}:`);
    console.log(`   Owner: ${vault.owner.toBase58().slice(0, 8)}...`);
    console.log(`   Total Balance: ${formatUSDT(vault.totalBalance)}`);
    console.log(`   Available: ${formatUSDT(vault.availableBalance)}`);
    console.log(`   Locked: ${formatUSDT(vault.lockedBalance)}`);
    console.log(`   Total Deposited: ${formatUSDT(vault.totalDeposited)}`);
    console.log(`   Total Withdrawn: ${formatUSDT(vault.totalWithdrawn)}`);
  } catch (e) {
    console.log(`   ⚠️  Could not fetch vault state: ${e}`);
  }
};

describe("End-to-End Demo: Complete Collateral Vault Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.collateralVault as Program<CollateralVault>;
  const mockProgram = anchor.workspace.mockPositionManager as Program<MockPositionManager>;

  // Sample data
  const SAMPLE_DATA = {
    user1InitialBalance: 10_000_000_000n, // 10,000 USDT
    user2InitialBalance: 5_000_000_000n,  // 5,000 USDT
    deposit1: 5_000_000_000n,              // 5,000 USDT
    deposit2: 2_000_000_000n,               // 2,000 USDT
    lockAmount: 3_000_000_000n,             // 3,000 USDT
    unlockAmount: 1_000_000_000n,           // 1,000 USDT
    withdrawAmount: 1_500_000_000n,         // 1,500 USDT
    transferAmount: 500_000_000n,           // 500 USDT
  };

  it("Complete E2E Flow: Initialize → Deposit → Lock → Unlock → Withdraw → Transfer", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    printSection("🚀 Starting End-to-End Demo");

    // ========================================================================
    // STEP 1: Setup - Create USDT Mint and Fund Users
    // ========================================================================
    printSection("STEP 1: Setup - Creating USDT Mint");

    const usdtMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      6 // 6 decimals like real USDT
    );
    console.log(`✅ Created USDT Mint: ${usdtMint.toBase58()}`);

    // Create two users for the demo
    const user1 = web3.Keypair.generate();
    const user2 = web3.Keypair.generate();

    // Airdrop SOL for transaction fees
    await connection.confirmTransaction(
      await connection.requestAirdrop(user1.publicKey, 2 * web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    await connection.confirmTransaction(
      await connection.requestAirdrop(user2.publicKey, 2 * web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    console.log(`✅ Funded User 1: ${user1.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`✅ Funded User 2: ${user2.publicKey.toBase58().slice(0, 8)}...`);

    // Create token accounts and mint USDT
    const user1Ata = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      user1.publicKey
    );
    const user2Ata = await getOrCreateAssociatedTokenAccount(
      connection,
      user.payer,
      usdtMint,
      user2.publicKey
    );

    await mintTo(
      connection,
      user.payer,
      usdtMint,
      user1Ata.address,
      user.publicKey,
      SAMPLE_DATA.user1InitialBalance
    );
    await mintTo(
      connection,
      user.payer,
      usdtMint,
      user2Ata.address,
      user.publicKey,
      SAMPLE_DATA.user2InitialBalance
    );
    console.log(`✅ Minted ${formatUSDT(SAMPLE_DATA.user1InitialBalance)} to User 1`);
    console.log(`✅ Minted ${formatUSDT(SAMPLE_DATA.user2InitialBalance)} to User 2`);

    // ========================================================================
    // STEP 2: Initialize Vault Authority
    // ========================================================================
    printSection("STEP 2: Initialize Vault Authority");

    const [vaultAuthorityPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );

    try {
      await program.methods
        .initializeVaultAuthority([mockProgram.programId], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaultAuthorityPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      console.log(`✅ Vault Authority initialized`);
      console.log(`   Authority PDA: ${vaultAuthorityPda.toBase58()}`);
      console.log(`   Authorized Program: ${mockProgram.programId.toBase58().slice(0, 8)}...`);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log(`✅ Vault Authority already exists`);
      } else {
        // Try to add the program if authority exists
        const va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
        const isAuthorized = (va.authorizedPrograms as web3.PublicKey[]).some(
          (p) => p.toBase58() === mockProgram.programId.toBase58()
        );
        if (!isAuthorized) {
          await (program as any).methods
            .addAuthorizedProgram(mockProgram.programId)
            .accountsPartial({
              governance: user.publicKey,
              vaultAuthority: vaultAuthorityPda,
            })
            .rpc();
          console.log(`✅ Added mock program to authorized list`);
        }
      }
    }

    // ========================================================================
    // STEP 3: Initialize Vaults for Both Users
    // ========================================================================
    printSection("STEP 3: Initialize User Vaults");

    // User 1 Vault
    const [vault1Pda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), user1.publicKey.toBuffer()],
      program.programId
    );
    const vault1Ata = await getAssociatedTokenAddress(usdtMint, vault1Pda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: user1.publicKey,
        vault: vault1Pda,
        vaultTokenAccount: vault1Ata,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user1])
      .rpc();

    console.log(`✅ User 1 Vault initialized`);
    console.log(`   Vault PDA: ${vault1Pda.toBase58()}`);

    // User 2 Vault
    const [vault2Pda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), user2.publicKey.toBuffer()],
      program.programId
    );
    const vault2Ata = await getAssociatedTokenAddress(usdtMint, vault2Pda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: user2.publicKey,
        vault: vault2Pda,
        vaultTokenAccount: vault2Ata,
        usdtMint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user2])
      .rpc();

    console.log(`✅ User 2 Vault initialized`);
    console.log(`   Vault PDA: ${vault2Pda.toBase58()}`);

    await printVaultState(program, vault1Pda, "User 1 Vault (Initial)");
    await printVaultState(program, vault2Pda, "User 2 Vault (Initial)");

    // ========================================================================
    // STEP 4: Deposit Collateral
    // ========================================================================
    printSection("STEP 4: Deposit Collateral");

    // User 1 deposits
    console.log(`\n💰 User 1 depositing ${formatUSDT(SAMPLE_DATA.deposit1)}...`);
    await program.methods
      .deposit(new BN(SAMPLE_DATA.deposit1.toString()))
      .accountsPartial({
        user: user1.publicKey,
        vault: vault1Pda,
        userTokenAccount: user1Ata.address,
        vaultTokenAccount: vault1Ata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();
    console.log(`✅ Deposit successful!`);

    // User 1 deposits again
    console.log(`\n💰 User 1 depositing ${formatUSDT(SAMPLE_DATA.deposit2)} more...`);
    await program.methods
      .deposit(new BN(SAMPLE_DATA.deposit2.toString()))
      .accountsPartial({
        user: user1.publicKey,
        vault: vault1Pda,
        userTokenAccount: user1Ata.address,
        vaultTokenAccount: vault1Ata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();
    console.log(`✅ Second deposit successful!`);

    await printVaultState(program, vault1Pda, "User 1 Vault (After Deposits)");

    // Check user's remaining balance
    const user1Balance = await getAccount(connection, user1Ata);
    console.log(`\n💵 User 1 Wallet Balance: ${formatUSDT(user1Balance.amount)}`);

    // ========================================================================
    // STEP 5: Lock Collateral (via CPI from Mock Position Manager)
    // ========================================================================
    printSection("STEP 5: Lock Collateral (Opening Position)");

    // Initialize position summary for mock program
    const [summary1Pda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position_summary"), vault1Pda.toBuffer()],
      mockProgram.programId
    );

    try {
      await mockProgram.methods
        .initPositionSummary()
        .accounts({
          payer: user1.publicKey,
          vault: vault1Pda,
          positionSummary: summary1Pda,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    } catch (e) {
      // Already exists, that's fine
    }

    console.log(`\n🔒 Locking ${formatUSDT(SAMPLE_DATA.lockAmount)} for position margin...`);
    await mockProgram.methods
      .openPosition(new BN(SAMPLE_DATA.lockAmount.toString()))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vault1Pda,
        positionSummary: summary1Pda,
        collateralVaultProgram: program.programId,
      })
      .rpc();
    console.log(`✅ Collateral locked successfully!`);

    await printVaultState(program, vault1Pda, "User 1 Vault (After Lock)");

    // ========================================================================
    // STEP 6: Try to Withdraw While Locked (Should Fail)
    // ========================================================================
    printSection("STEP 6: Attempt Withdrawal While Locked (Should Fail)");

    console.log(`\n⚠️  Attempting to withdraw ${formatUSDT(SAMPLE_DATA.withdrawAmount)} while collateral is locked...`);
    let withdrawFailed = false;
    try {
      await program.methods
        .withdraw(new BN(SAMPLE_DATA.withdrawAmount.toString()))
        .accountsPartial({
          user: user1.publicKey,
          vault: vault1Pda,
          vaultTokenAccount: vault1Ata,
          userTokenAccount: user1Ata.address,
          vaultAuthority: vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: summary1Pda,
            isSigner: false,
            isWritable: false,
          },
        ])
        .signers([user1])
        .rpc();
    } catch (e: any) {
      withdrawFailed = true;
      console.log(`✅ Withdrawal correctly rejected: ${e.message?.slice(0, 100)}...`);
    }
    expect(withdrawFailed).to.be.true;

    // ========================================================================
    // STEP 7: Unlock Collateral (Closing Position)
    // ========================================================================
    printSection("STEP 7: Unlock Collateral (Closing Position)");

    console.log(`\n🔓 Unlocking ${formatUSDT(SAMPLE_DATA.unlockAmount)} from position...`);
    await mockProgram.methods
      .closePosition(new BN(SAMPLE_DATA.unlockAmount.toString()))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        vault: vault1Pda,
        positionSummary: summary1Pda,
        collateralVaultProgram: program.programId,
      })
      .rpc();
    console.log(`✅ Collateral unlocked successfully!`);

    await printVaultState(program, vault1Pda, "User 1 Vault (After Partial Unlock)");

    // ========================================================================
    // STEP 8: Withdraw Available Collateral
    // ========================================================================
    printSection("STEP 8: Withdraw Available Collateral");

    // First, unlock all remaining locked collateral
    const vault1 = await program.account.collateralVault.fetch(vault1Pda);
    const remainingLocked = new BN(vault1.lockedBalance.toString());
    
    if (remainingLocked.gt(new BN(0))) {
      console.log(`\n🔓 Unlocking remaining ${formatUSDT(remainingLocked)}...`);
      await mockProgram.methods
        .closePosition(remainingLocked)
        .accounts({
          callerProgram: mockProgram.programId,
          vaultAuthority: vaultAuthorityPda,
          instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          vault: vault1Pda,
          positionSummary: summary1Pda,
          collateralVaultProgram: program.programId,
        })
        .rpc();
    }

    // Now withdraw
    console.log(`\n💸 Withdrawing ${formatUSDT(SAMPLE_DATA.withdrawAmount)}...`);
    await program.methods
      .withdraw(new BN(SAMPLE_DATA.withdrawAmount.toString()))
      .accountsPartial({
        user: user1.publicKey,
        vault: vault1Pda,
        vaultTokenAccount: vault1Ata,
        userTokenAccount: user1Ata.address,
        vaultAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: summary1Pda,
          isSigner: false,
          isWritable: false,
        },
      ])
      .signers([user1])
      .rpc();
    console.log(`✅ Withdrawal successful!`);

    await printVaultState(program, vault1Pda, "User 1 Vault (After Withdrawal)");

    // Check user's balance
    const user1BalanceAfter = await getAccount(connection, user1Ata);
    console.log(`\n💵 User 1 Wallet Balance: ${formatUSDT(user1BalanceAfter.amount)}`);

    // ========================================================================
    // STEP 9: Transfer Between Vaults (via CPI)
    // ========================================================================
    printSection("STEP 9: Transfer Between Vaults");

    // User 2 deposits first
    console.log(`\n💰 User 2 depositing ${formatUSDT(SAMPLE_DATA.deposit2)}...`);
    await program.methods
      .deposit(new BN(SAMPLE_DATA.deposit2.toString()))
      .accountsPartial({
        user: user2.publicKey,
        vault: vault2Pda,
        userTokenAccount: user2Ata.address,
        vaultTokenAccount: vault2Ata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    await printVaultState(program, vault1Pda, "User 1 Vault (Before Transfer)");
    await printVaultState(program, vault2Pda, "User 2 Vault (Before Transfer)");

    // Transfer from User 1 to User 2 (simulating settlement/liquidation)
    console.log(`\n🔄 Transferring ${formatUSDT(SAMPLE_DATA.transferAmount)} from User 1 to User 2...`);
    await mockProgram.methods
      .rebalanceCollateral(new BN(SAMPLE_DATA.transferAmount.toString()))
      .accounts({
        callerProgram: mockProgram.programId,
        vaultAuthority: vaultAuthorityPda,
        instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        fromVault: vault1Pda,
        toVault: vault2Pda,
        fromVaultTokenAccount: vault1Ata,
        toVaultTokenAccount: vault2Ata,
        tokenProgram: TOKEN_PROGRAM_ID,
        collateralVaultProgram: program.programId,
      })
      .rpc();
    console.log(`✅ Transfer successful!`);

    await printVaultState(program, vault1Pda, "User 1 Vault (After Transfer)");
    await printVaultState(program, vault2Pda, "User 2 Vault (After Transfer)");

    // ========================================================================
    // FINAL SUMMARY
    // ========================================================================
    printSection("📋 Final Summary");

    const finalVault1 = await program.account.collateralVault.fetch(vault1Pda);
    const finalVault2 = await program.account.collateralVault.fetch(vault2Pda);

    console.log("\n✅ End-to-End Test Completed Successfully!");
    console.log("\n📊 Final State:");
    console.log(`   User 1 Vault:`);
    console.log(`     Total: ${formatUSDT(finalVault1.totalBalance)}`);
    console.log(`     Available: ${formatUSDT(finalVault1.availableBalance)}`);
    console.log(`     Locked: ${formatUSDT(finalVault1.lockedBalance)}`);
    console.log(`     Deposited: ${formatUSDT(finalVault1.totalDeposited)}`);
    console.log(`     Withdrawn: ${formatUSDT(finalVault1.totalWithdrawn)}`);
    console.log(`   User 2 Vault:`);
    console.log(`     Total: ${formatUSDT(finalVault2.totalBalance)}`);
    console.log(`     Available: ${formatUSDT(finalVault2.availableBalance)}`);
    console.log(`     Locked: ${formatUSDT(finalVault2.lockedBalance)}`);

    // Verify invariants
    expect(finalVault1.totalBalance.toString()).to.equal(
      finalVault1.availableBalance.add(finalVault1.lockedBalance).toString()
    );
    expect(finalVault2.totalBalance.toString()).to.equal(
      finalVault2.availableBalance.add(finalVault2.lockedBalance).toString()
    );

    console.log("\n✅ All invariants maintained!");
    console.log("=".repeat(60));
  });
});
