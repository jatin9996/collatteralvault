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

describe("integration: deposit/lock/withdraw + update/close", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.collateralVault as Program<CollateralVault>;

  it("deposit → lock → withdraw fails while locked (OpenPositionsExist)", async () => {
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

    // deposit 0.5
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

    // init vault authority and authorize random caller (simulate position manager)
    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );
    const caller = web3.Keypair.generate().publicKey;
    try {
      await program.methods
        .initializeVaultAuthority([caller], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      // ensure present if already initialized
      const va = await program.account.vaultAuthority.fetch(vaPda);
      const present = (va.authorizedPrograms as web3.PublicKey[]).some(
        (p) => p.toBase58() === caller.toBase58()
      );
      if (!present) {
        await (program as any).methods
          .addAuthorizedProgram(caller)
          .accountsPartial({ governance: user.publicKey, vaultAuthority: vaPda })
          .rpc();
      }
    }

    // lock 0.3
    await (program as any).methods
      .lockCollateral(new BN(300_000))
      .accountsPartial({ callerProgram: caller, vaultAuthority: vaPda, vault: vaultPda })
      .rpc();

    // withdraw should fail while any locked balance exists
    let threw = false;
    try {
      await (program as any).methods
        .withdraw(new BN(100_000))
        .accountsPartial({
          user: owner.publicKey,
          vault: vaultPda,
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

  it("update_usdt_mint on empty vault and close_vault after zero balance", async () => {
    const user = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const owner = web3.Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // original mint
    const mintA = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );
    const [vaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    const vaultAtaA = await getAssociatedTokenAddress(mintA, vaultPda, true);

    await program.methods
      .initializeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAtaA,
        usdtMint: mintA,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();

    const [vaPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );
    // init VA if needed
    try {
      await program.methods
        .initializeVaultAuthority([], false)
        .accountsPartial({
          governance: user.publicKey,
          vaultAuthority: vaPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) {}

    // new mint
    const mintB = await createMint(
      connection,
      (user as any).payer,
      user.publicKey,
      null,
      6
    );
    const vaultAtaB = await getAssociatedTokenAddress(mintB, vaultPda, true);

    // update mint on empty vault
    await program.methods
      .updateUsdtMint()
      .accountsPartial({
        governance: user.publicKey,
        vaultAuthority: vaPda,
        vault: vaultPda,
        vaultTokenAccount: vaultAtaB,
        newMint: mintB,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const v = await program.account.collateralVault.fetch(vaultPda);
    expect(v.usdtMint.toBase58()).to.eq(mintB.toBase58());
    expect(v.tokenAccount.toBase58()).to.eq(vaultAtaB.toBase58());

    // close vault (empty)
    await (program as any).methods
      .closeVault()
      .accountsPartial({
        user: owner.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultAtaB,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    // fetch should fail after close
    let closed = false;
    try {
      await program.account.collateralVault.fetch(vaultPda);
    } catch (_) {
      closed = true;
    }
    expect(closed).to.eq(true);
  });
});


