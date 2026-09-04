import { type JsonObject } from "@lumenbazaar/shared";

export type ConformanceTest = {
  name: string;
  description: string;
  network: "stellar:testnet" | "stellar:pubnet";
  scheme: "exact" | "upto";
};

export type ConformanceResult = {
  testName: string;
  passed: boolean;
  error?: string;
  duration: number;
};

export type ConformanceRun = {
  network: "stellar:testnet" | "stellar:pubnet";
  scheme: "exact" | "upto";
  results: ConformanceResult[];
  startedAt: string;
  completedAt: string;
  passedCount: number;
  failedCount: number;
};

/**
 * x402 Conformance test suite
 */
export class ConformanceTestSuite {
  private tests: ConformanceTest[] = [];
  private results: ConformanceResult[] = [];

  /**
   * Define a conformance test
   */
  defineTest(test: ConformanceTest): void {
    this.tests.push(test);
  }

  /**
   * Run a conformance test
   */
  async runTest(
    test: ConformanceTest,
    runner: (test: ConformanceTest) => Promise<void>
  ): Promise<ConformanceResult> {
    const startTime = Date.now();

    try {
      await runner(test);

      return {
        testName: test.name,
        passed: true,
        duration: Date.now() - startTime
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      return {
        testName: test.name,
        passed: false,
        error,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Run all conformance tests
   */
  async runAll(runner: (test: ConformanceTest) => Promise<void>): Promise<ConformanceRun> {
    const startedAt = new Date().toISOString();
    const results: ConformanceResult[] = [];

    for (const test of this.tests) {
      const result = await this.runTest(test, runner);
      results.push(result);
    }

    const completedAt = new Date().toISOString();
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;

    const network = (this.tests[0]?.network || "stellar:testnet") as "stellar:testnet" | "stellar:pubnet";
    const scheme = (this.tests[0]?.scheme || "exact") as "exact" | "upto";

    return {
      network,
      scheme,
      results,
      startedAt,
      completedAt,
      passedCount,
      failedCount
    };
  }

  /**
   * Get test results
   */
  getResults(): ConformanceResult[] {
    return [...this.results];
  }

  /**
   * Reset test suite
   */
  reset(): void {
    this.tests = [];
    this.results = [];
  }
}

/**
 * Create conformance test suite
 */
export function createConformanceTestSuite(): ConformanceTestSuite {
  return new ConformanceTestSuite();
}

/**
 * Standard x402 exact scheme tests
 */
export const exactSchemeTests: ConformanceTest[] = [
  {
    name: "GET /v1/supported returns exact scheme",
    description: "Verify /supported endpoint returns exact scheme",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "POST /v1/verify accepts exact payment",
    description: "Verify /verify accepts exact scheme payment",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "POST /v1/settle processes exact payment",
    description: "Verify /settle accepts and processes exact payment",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "GET /v1/receipts/:id returns settlement receipt",
    description: "Verify /receipts returns finalized receipt",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "Replay protection prevents duplicate payments",
    description: "Verify payment hash uniqueness prevents replays",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "Invalid signatures are rejected",
    description: "Verify invalid signatures fail verification",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "Wrong recipient payment is rejected",
    description: "Verify wrong recipient fails settlement",
    network: "stellar:testnet",
    scheme: "exact"
  },
  {
    name: "Expired auth entries are rejected",
    description: "Verify expired auth entries fail verification",
    network: "stellar:testnet",
    scheme: "exact"
  }
];

/**
 * Standard upto scheme tests (for future implementation)
 */
export const uptoSchemeTests: ConformanceTest[] = [
  {
    name: "GET /v1/supported returns upto scheme",
    description: "Verify /supported endpoint returns upto scheme",
    network: "stellar:testnet",
    scheme: "upto"
  },
  {
    name: "POST /v1/session creates payment session",
    description: "Verify /session creates upto session",
    network: "stellar:testnet",
    scheme: "upto"
  },
  {
    name: "POST /v1/settle processes upto payment",
    description: "Verify /settle accepts upto scheme payment",
    network: "stellar:testnet",
    scheme: "upto"
  }
];
