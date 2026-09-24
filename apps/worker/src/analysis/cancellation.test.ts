import { describe, expect, it } from "vitest";
import { AnalysisCancelledError, cancellationOutcome } from "./cancellation.js";

describe("analysis cancellation", () => {
  it("classifies cancellation before media processing as refundable", () => {
    expect(cancellationOutcome(false)).toBe("before_processing");
    expect(new AnalysisCancelledError("before_processing").outcome).toBe("before_processing");
  });

  it("classifies cancellation after media processing as chargeable", () => {
    expect(cancellationOutcome(true)).toBe("after_processing");
    expect(new AnalysisCancelledError("after_processing").outcome).toBe("after_processing");
  });
});
