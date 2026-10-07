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
import { assertCatalogJsonSafe, assertSafeResourceTarget } from "./resources.js";
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
      try {
        assertSafeResourceTarget(
          metadata.resource.url,
          metadata.resource.type,
          metadata.resource.routeTemplate,
          seller.domain
        );
      } catch (error) {
        pushLumenError(error, errors, ["resource", "url"]);
      }

      if (seller.domainVerifiedAt === null) {
        errors.push(
          issue(
            "SELLER_DOMAIN_UNVERIFIED",
            "Catalog publication requires verified seller domain ownership.",
            ["sellerId"]
          )
        );
      }
    }

    this.validateRoute(
      metadata.resource.type,
      metadata.resource.routeTemplate,
      metadata.resource.inputSchema as JsonObject,
      errors
    );
    this.validatePayment(metadata.resource, errors);
    this.validateSchemas(
      metadata.resource.inputSchema as JsonObject,
      metadata.resource.outputSchema as JsonObject,
      metadata.resource.extensions as JsonObject,
      errors,
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
    type: "http" | "mcp",
    routeTemplate: string,
    inputSchema: JsonObject,
    errors: CatalogValidationIssue[]
  ) {
    try {
      if (type === "mcp") {
        if (!/^mcp:\/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_-]+$/u.test(routeTemplate)) {
          throw new LumenError(
            "ROUTE_TEMPLATE_INVALID",
            "MCP route template must use mcp://server/tool format."
          );
        }
      } else {
        validateRouteTemplate(routeTemplate, inputSchema);
      }
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
    extensions: JsonObject,
    errors: CatalogValidationIssue[],
    warnings: CatalogValidationIssue[]
  ) {
    for (const [value, label, maxBytes, path] of [
      [inputSchema, "Input schema", 64 * 1024, ["resource", "inputSchema"]],
      [outputSchema, "Output schema", 64 * 1024, ["resource", "outputSchema"]],
      [extensions, "Resource extensions", 32 * 1024, ["resource", "extensions"]]
    ] as const) {
      try {
        assertCatalogJsonSafe(value, label, maxBytes);
      } catch (error) {
        pushLumenError(error, errors, [...path]);
      }
    }

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
