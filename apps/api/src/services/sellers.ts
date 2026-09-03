import { randomUUID } from "node:crypto";

import { z } from "zod";

import { LumenError, type Seller } from "@lumenbazaar/shared";
import { assertStellarPublicKey } from "@lumenbazaar/stellar-payments";

const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i;

export const createSellerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  walletAddress: z.string().trim().min(1),
  domain: z.string().trim().toLowerCase().regex(domainPattern, "Domain is invalid.")
});

export type CreateSellerInput = z.output<typeof createSellerSchema>;

export type SellerStore = {
  createSeller: (input: CreateSellerInput) => Promise<Seller>;
  getSeller: (sellerId: string) => Promise<Seller | undefined>;
  findSellerByWallet: (walletAddress: string) => Promise<Seller | undefined>;
};

export class InMemorySellerStore implements SellerStore {
  private readonly sellers = new Map<string, Seller>();
  private readonly byWallet = new Map<string, string>();

  async createSeller(input: CreateSellerInput) {
    if (this.byWallet.has(input.walletAddress)) {
      throw new LumenError("VALIDATION_FAILED", "Seller wallet address already exists.");
    }

    const now = new Date().toISOString();
    const seller: Seller = {
      id: `seller_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      displayName: input.displayName,
      walletAddress: input.walletAddress,
      domain: input.domain,
      domainVerifiedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.sellers.set(seller.id, seller);
    this.byWallet.set(seller.walletAddress, seller.id);

    return seller;
  }

  async getSeller(sellerId: string) {
    return this.sellers.get(sellerId);
  }

  async findSellerByWallet(walletAddress: string) {
    const sellerId = this.byWallet.get(walletAddress);
    return sellerId === undefined ? undefined : this.sellers.get(sellerId);
  }
}

export class SellerService {
  constructor(private readonly store: SellerStore = new InMemorySellerStore()) {}

  async createSeller(input: unknown) {
    const seller = createSellerSchema.parse(input);
    assertStellarPublicKey(seller.walletAddress, "walletAddress");
    return this.store.createSeller(seller);
  }

  async getSeller(sellerId: string) {
    const seller = await this.store.getSeller(sellerId);

    if (seller === undefined) {
      throw new LumenError("SELLER_NOT_FOUND", "Seller was not found.");
    }

    return seller;
  }

  getStore() {
    return this.store;
  }
}
