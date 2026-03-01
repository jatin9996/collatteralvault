/**
 * Unit tests for all vault operations.
 * Each describe block covers one operation with success and failure cases.
 */
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

describe("vault-operations: unit tests for all vault ops", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.collateralVault as Program<CollateralVault>;
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

  type VaultSetup = {
    owner: web3.Keypair;
    usdtMint: web3.PublicKey;
    vaultPda: web3.PublicKey;
    vaultAta: web3.PublicKey;
    ownerAta: web3.PublicKey;
  };

  async function setupVaultWithBalance(
    connection: anchor.web3.Connection,
    payer: anchor.Wallet,
    depositAmount: number
  ): Promise<VaultSetup> {
    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );
    const usdtMint = await createMint(
      connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      usdtMint,
      owner.publicKey
    );
    await mintTo(
      connection,
      payer.payer,
      usdtMint,
      ownerAta.address,
      payer.publicKey,
      BigInt(Math.max(depositAmount, 1_000_000))
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
    if (depositAmount > 0) {
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
    }
    return { owner, usdtMint, vaultPda, vaultAta, ownerAta };
  }

  describe("emergency_withdraw", () => {
    it("owner can emergency withdraw when no locked balance", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, usdtMint, vaultPda, vaultAta, ownerAta } =
        await setupVaultWithBalance(provider.connection, user, 500_000);
      await (program as any).methods
        .emergencyWithdraw(new BN(200_000))
        .accountsPartial({
          authority: owner.publicKey,
          owner: owner.publicKey,
          vault: vaultPda,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: vaultAta,
          userTokenAccount: ownerAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
      const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(new BN(vaultAcc.totalBalance).toNumber()).to.eq(300_000);
      expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(300_000);
      expect(new BN(vaultAcc.totalWithdrawn).toNumber()).to.eq(200_000);
    });

    it("emergency_withdraw amount 0 fails", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, usdtMint, vaultPda, vaultAta, ownerAta } =
        await setupVaultWithBalance(provider.connection, user, 100_000);
      let threw = false;
      try {
        await (program as any).methods
          .emergencyWithdraw(new BN(0))
          .accountsPartial({
            authority: owner.publicKey,
            owner: owner.publicKey,
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

    it("unauthorized signer cannot emergency withdraw", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda, vaultAta, ownerAta } =
        await setupVaultWithBalance(provider.connection, user, 100_000);
      const other = web3.Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(other.publicKey, web3.LAMPORTS_PER_SOL),
        "confirmed"
      );
      let threw = false;
      try {
        await (program as any).methods
          .emergencyWithdraw(new BN(10_000))
          .accountsPartial({
            authority: other.publicKey,
            owner: owner.publicKey,
            vault: vaultPda,
            vaultAuthority: vaultAuthorityPda,
            vaultTokenAccount: vaultAta,
            userTokenAccount: ownerAta.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([other])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });

  describe("request_withdraw", () => {
    it("succeeds when min_withdraw_delay is set", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 300_000);
      await (program as any).methods
        .setWithdrawMinDelay(new BN(60))
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      await (program as any).methods
        .requestWithdraw(new BN(50_000))
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.pendingWithdrawals.length).to.eq(1);
      expect(new BN(vaultAcc.pendingWithdrawals[0].amount).toNumber()).to.eq(50_000);
    });

    it("request_withdraw fails when min_delay not set", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 100_000);
      let threw = false;
      try {
        await (program as any).methods
          .requestWithdraw(new BN(10_000))
          .accountsPartial({
            owner: owner.publicKey,
            vault: vaultPda,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });

  describe("schedule_timelock and release_timelocks", () => {
    it("schedule_timelock adds entry and release_timelocks releases matured", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 400_000);
      await (program as any).methods
        .scheduleTimelock(new BN(100_000), new BN(0))
        .accountsPartial({
          authority: owner.publicKey,
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      let vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.timelocks.length).to.eq(1);
      expect(new BN(vaultAcc.timelocks[0].amount).toNumber()).to.eq(100_000);
      expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(300_000);

      await (program as any).methods
        .releaseTimelocks()
        .accountsPartial({
          authority: owner.publicKey,
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.timelocks.length).to.eq(0);
      expect(new BN(vaultAcc.availableBalance).toNumber()).to.eq(400_000);
    });

    it("schedule_timelock amount 0 fails", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 100_000);
      let threw = false;
      try {
        await (program as any).methods
          .scheduleTimelock(new BN(0), new BN(60))
          .accountsPartial({
            authority: owner.publicKey,
            owner: owner.publicKey,
            vault: vaultPda,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });

  describe("set_vault_multisig and disable_vault_multisig", () => {
    it("set_vault_multisig and disable_vault_multisig update vault", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 100_000);
      const signer1 = web3.Keypair.generate().publicKey;
      const signer2 = web3.Keypair.generate().publicKey;
      await (program as any).methods
        .setVaultMultisig([signer1, signer2], 2)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      let vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.multisigThreshold).to.eq(2);
      expect(vaultAcc.multisigSigners.length).to.eq(2);

      await (program as any).methods
        .disableVaultMultisig()
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.multisigThreshold).to.eq(0);
      expect(vaultAcc.multisigSigners.length).to.eq(0);
    });

    it("set_vault_multisig threshold > signers length fails", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      const signer1 = web3.Keypair.generate().publicKey;
      let threw = false;
      try {
        await (program as any).methods
          .setVaultMultisig([signer1], 2)
          .accountsPartial({
            owner: owner.publicKey,
            vault: vaultPda,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });

  describe("add_delegate and remove_delegate", () => {
    it("add_delegate and remove_delegate update vault delegates", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 100_000);
      const delegate = web3.Keypair.generate().publicKey;
      await (program as any).methods
        .addDelegate(delegate)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      let vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.delegates.length).to.eq(1);
      expect(vaultAcc.delegates[0].toBase58()).to.eq(delegate.toBase58());

      await (program as any).methods
        .removeDelegate(delegate)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.delegates.length).to.eq(0);
    });

    it("add_delegate duplicate fails", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      const delegate = web3.Keypair.generate().publicKey;
      await (program as any).methods
        .addDelegate(delegate)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      let threw = false;
      try {
        await (program as any).methods
          .addDelegate(delegate)
          .accountsPartial({
            owner: owner.publicKey,
            vault: vaultPda,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });

    it("remove_delegate non-existent fails", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      const notAdded = web3.Keypair.generate().publicKey;
      let threw = false;
      try {
        await (program as any).methods
          .removeDelegate(notAdded)
          .accountsPartial({
            owner: owner.publicKey,
            vault: vaultPda,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });

  describe("withdraw_policy: set_min_delay, set_rate_limit, whitelist", () => {
    it("set_withdraw_min_delay updates vault", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      await (program as any).methods
        .setWithdrawMinDelay(new BN(120))
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(new BN(vaultAcc.minWithdrawDelaySeconds).toNumber()).to.eq(120);
    });

    it("set_withdraw_rate_limit updates vault", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      await (program as any).methods
        .setWithdrawRateLimit(3600, new BN(100_000))
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      const vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.rateWindowSeconds).to.eq(3600);
      expect(new BN(vaultAcc.rateLimitAmount).toNumber()).to.eq(100_000);
    });

    it("add_withdraw_whitelist and remove_withdraw_whitelist update vault", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      const addr = web3.Keypair.generate().publicKey;
      await (program as any).methods
        .addWithdrawWhitelist(addr)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      let vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.withdrawWhitelist.length).to.eq(1);
      expect(vaultAcc.withdrawWhitelist[0].toBase58()).to.eq(addr.toBase58());

      await (program as any).methods
        .removeWithdrawWhitelist(addr)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      vaultAcc = await program.account.collateralVault.fetch(vaultPda);
      expect(vaultAcc.withdrawWhitelist.length).to.eq(0);
    });

    it("add_withdraw_whitelist duplicate fails", async () => {
      await ensureVaultAuthority([]);
      const user = provider.wallet as anchor.Wallet;
      const { owner, vaultPda } =
        await setupVaultWithBalance(provider.connection, user, 0);
      const addr = web3.Keypair.generate().publicKey;
      await (program as any).methods
        .addWithdrawWhitelist(addr)
        .accountsPartial({
          owner: owner.publicKey,
          vault: vaultPda,
        })
        .signers([owner])
        .rpc();
      let threw = false;
      try {
        await (program as any).methods
          .addWithdrawWhitelist(addr)
          .accountsPartial({
            owner: owner.publicKey,
            vault: vaultPda,
          })
          .signers([owner])
          .rpc();
      } catch (_) {
        threw = true;
      }
      expect(threw).to.eq(true);
    });
  });
});
