import test from "node:test";
import assert from "node:assert";
import { maxLimit } from "./limit.mjs";

// GD-loan-001 — the signed answer key, word for word
test("รายได้ 30,000", () => assert.equal(maxLimit(30000), 150000));
test("รายได้ 12,500", () => assert.equal(maxLimit(12500), 62500));
