/**
 * Integration tests for SPL Token transfers in the Collateral Vault.
 * Verifies that deposit (user → vault), withdraw (vault → user), and
 * transfer_collateral (vault → vault via CPI) correctly move SPL tokens
 * and that on-chain token account balances match vault state.
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

describe("integration: SPL Token transfers", () => {
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
  };

  describe("deposit (user ATA → vault ATA)", () => {
    it("transfers SPL tokens from user ATA to vault ATA and updates both balances", async () => {
      const user = provider.wallet as anchor.Wallet;
      const connection = provider.connection;

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

      const beforeUser = await getAccount(connection, ownerAta.address);
      const beforeVault = await getAccount(connection, vaultAta);
      expect(Number(beforeUser.amount)).to.eq(1_000_000);
      expect(Number(beforeVault.amount)).to.eq(0);

      const depositAmount = 400_000;
      await program.methods
        .deposit(new BN(depositAmount))
        .accountsPartial({
          user: owner.publicKey,
          vault: vaultPda,
          userTokenAccount: ownerAta.address,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();

      const afterUser = await getAccount(connection, ownerAta.address);
      const afterVault = await getAccount(connection, vaultAta);
      expect(Number(afterUser.amount)).to.eq(1_000_000 - depositAmount);
      expect(Number(afterVault.amount)).to.eq(depositAmount);

      const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(depositAmount);
      expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(depositAmount);
    });

    it("deposit zero amount fails with InvalidAmount", async () => {
      const user = provider.wallet as anchor.Wallet;
      const connection = provider.connection;

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
        100_000n
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

      let threw = false;
      try {
        await program.methods
          .deposit(new BN(0))
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
    });
  });

  describe("withdraw (vault ATA → user ATA)", () => {
    it("transfers SPL tokens from vault ATA to user ATA and updates both balances", async () => {
      await ensureVaultAuthority([]);

      const user = provider.wallet as anchor.Wallet;
      const connection = provider.connection;

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

      const beforeVault = await getAccount(connection, vaultAta);
      const beforeUser = await getAccount(connection, ownerAta.address);
      expect(Number(beforeVault.amount)).to.eq(600_000);
      expect(Number(beforeUser.amount)).to.eq(400_000);

      const withdrawAmount = 200_000;
      await (program as any).methods
        .withdraw(new BN(withdrawAmount))
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

      const afterVault = await getAccount(connection, vaultAta);
      const afterUser = await getAccount(connection, ownerAta.address);
      expect(Number(afterVault.amount)).to.eq(600_000 - withdrawAmount);
      expect(Number(afterUser.amount)).to.eq(400_000 + withdrawAmount);

      const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(400_000);
      expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(400_000);
    });

    it("withdraw amount exceeding available balance fails", async () => {
      await ensureVaultAuthority([]);

      const user = provider.wallet as anchor.Wallet;
      const connection = provider.connection;

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

      let threw = false;
      try {
        await (program as any).methods
          .withdraw(new BN(150_000))
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
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });

  describe("transfer_collateral (vault A ATA → vault B ATA via CPI)", () => {
    it("transfers SPL tokens between vault ATAs and updates both vault states", async () => {
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
      await mintTo(
        connection,
        (user as any).payer,
        usdtMint,
        aliceAta.address,
        user.publicKey,
        1_000_000n
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
        .deposit(new BN(500_000))
        .accountsPartial({
          user: alice.publicKey,
          vault: aliceVaultPda,
          userTokenAccount: aliceAta.address,
          vaultTokenAccount: aliceVaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([alice])
        .rpc();

      const beforeFromAta = await getAccount(connection, aliceVaultAta);
      const beforeToAta = await getAccount(connection, bobVaultAta);
      expect(Number(beforeFromAta.amount)).to.eq(500_000);
      expect(Number(beforeToAta.amount)).to.eq(0);

      const transferAmount = 150_000;
      await mockProgram.methods
        .rebalanceCollateral(new BN(transferAmount))
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

      const afterFromAta = await getAccount(connection, aliceVaultAta);
      const afterToAta = await getAccount(connection, bobVaultAta);
      expect(Number(afterFromAta.amount)).to.eq(500_000 - transferAmount);
      expect(Number(afterToAta.amount)).to.eq(transferAmount);

      const aliceVaultAcc = await program.account.collateralVault.fetch(aliceVaultPda);
      const bobVaultAcc = await program.account.collateralVault.fetch(bobVaultPda);
      expect(new BN(aliceVaultAcc.totalBalance).toNumber()).to.eq(500_000 - transferAmount);
      expect(new BN(aliceVaultAcc.availableBalance).toNumber()).to.eq(500_000 - transferAmount);
      expect(new BN(bobVaultAcc.totalBalance).toNumber()).to.eq(transferAmount);
      expect(new BN(bobVaultAcc.availableBalance).toNumber()).to.eq(transferAmount);
    });

    it("transfer_collateral amount exceeding from_vault available fails", async () => {
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
      await mintTo(
        connection,
        (user as any).payer,
        usdtMint,
        aliceAta.address,
        user.publicKey,
        200_000n
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
          .rebalanceCollateral(new BN(100_000))
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
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });
});
