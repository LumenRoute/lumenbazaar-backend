import { LumenError } from "@lumenbazaar/shared";

const stellarPublicKeyPattern = /^G[A-Z2-7]{55}$/;

export function assertStellarPublicKey(value: string, fieldName: string) {
  if (!stellarPublicKeyPattern.test(value)) {
    throw new LumenError("INVALID_PAYMENT_PAYLOAD", `${fieldName} must be a Stellar public key.`);
  }
}
