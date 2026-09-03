import { ZodError } from "zod";

import {
  type AppConfig,
  type ErrorCode,
  type JsonObject,
  LumenError,
  validateRouteTemplate
} from "@lumenbazaar/shared";
import {
  assertStellarPublicKey,
  normalizeExactAmount,
  requireSupportedAsset
} from "@lumenbazaar/stellar-payments";

import { parseDiscoveryMetadata } from "./discoveryMetadata.js";
import { type SellerService } from "./sellers.js";

export type CatalogValidationIssue = {
  code: ErrorCode;
  message: string;
  path?: string[];
};

export type CatalogValidationResult = {
  ok: boolean;
  warnings: CatalogValidationIssue[];
  errors: CatalogValidationIssue[];
};

export class CatalogValidationService {
  constructor(
    private readonly config: AppConfig,
    private readonly sellerService: SellerService
  ) {}

  async validate(input: unknown): Promise<CatalogValidationResult> {
    const warnings: CatalogValidationIssue[] = [];
    const errors: CatalogValidationIssue[] = [];
    const metadata = parseMetadata(input, errors);

    if (metadata === undefined) {
      return result(warnings, errors);
    }

    const seller = await this.findSeller(metadata.sellerId, errors);

    if (seller !== undefined) {
      const url = new URL(metadata.resource.url);

      if (!urlHostBelongsToDomain(url.hostname, seller.domain)) {
        errors.push(
          issue(
            "CATALOG_VALIDATION_FAILED",
            "Resource URL host does not belong to the seller domain.",
            ["resource", "url"]
          )
        );
      }

      if (metadata.resource.extensions.trusted === true && seller.domainVerifiedAt === null) {
        errors.push(
          issue(
            "SELLER_DOMAIN_UNVERIFIED",
            "Trusted catalog metadata requires verified seller domain ownership.",
            ["resource", "extensions", "trusted"]
          )
        );
      }
    }

    this.validateRoute(
      metadata.resource.routeTemplate,
      metadata.resource.inputSchema as JsonObject,
      errors
    );
    this.validatePayment(metadata.resource, errors);
    this.validateSchemas(
      metadata.resource.inputSchema as JsonObject,
      metadata.resource.outputSchema as JsonObject,
      warnings
    );

    return result(warnings, errors);
  }

  private async findSeller(sellerId: string, errors: CatalogValidationIssue[]) {
    try {
      return await this.sellerService.getSeller(sellerId);
    } catch (error) {
      if (error instanceof LumenError) {
        errors.push(issue(error.code, error.message, ["sellerId"]));
        return undefined;
      }

      throw error;
    }
  }

  private validateRoute(
    routeTemplate: string,
    inputSchema: JsonObject,
    errors: CatalogValidationIssue[]
  ) {
    try {
      validateRouteTemplate(routeTemplate, inputSchema);
    } catch (error) {
      pushLumenError(error, errors, ["resource", "routeTemplate"]);
    }
  }

  private validatePayment(
    resource: {
      network: "stellar:testnet" | "stellar:pubnet";
      payTo: string;
      assetCode: string;
      assetIssuer: string;
      amount: string;
    },
    errors: CatalogValidationIssue[]
  ) {
    try {
      assertStellarPublicKey(resource.payTo, "payTo");
      normalizeExactAmount(resource.amount);
      requireSupportedAsset(
        this.config,
        resource.network,
        resource.assetCode.toUpperCase(),
        resource.assetIssuer
      );
    } catch (error) {
      pushLumenError(error, errors, ["resource", "payment"]);
    }
  }

  private validateSchemas(
    inputSchema: JsonObject,
    outputSchema: JsonObject,
    warnings: CatalogValidationIssue[]
  ) {
    if (inputSchema.type !== "object") {
      warnings.push(issue("CATALOG_VALIDATION_FAILED", "Input schema should describe an object."));
    }

    if (outputSchema.type !== "object") {
      warnings.push(issue("CATALOG_VALIDATION_FAILED", "Output schema should describe an object."));
    }
  }
}

function parseMetadata(input: unknown, errors: CatalogValidationIssue[]) {
  try {
    return parseDiscoveryMetadata(input);
  } catch (error) {
    if (error instanceof ZodError) {
      errors.push(
        issue("CATALOG_VALIDATION_FAILED", "Discovery metadata shape is invalid.", ["metadata"])
      );
      return undefined;
    }

    throw error;
  }
}

function pushLumenError(error: unknown, errors: CatalogValidationIssue[], path: string[]) {
  if (error instanceof LumenError) {
    errors.push(issue(error.code, error.message, path));
    return;
  }

  throw error;
}

function result(warnings: CatalogValidationIssue[], errors: CatalogValidationIssue[]) {
  return {
    ok: errors.length === 0,
    warnings,
    errors
  };
}

function issue(code: ErrorCode, message: string, path?: string[]): CatalogValidationIssue {
  return {
    code,
    message,
    ...(path === undefined ? {} : { path })
  };
}

function urlHostBelongsToDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
