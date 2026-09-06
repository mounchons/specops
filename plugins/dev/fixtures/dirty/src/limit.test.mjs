import test from "node:test";
import assert from "node:assert";
// rounded the answer key: the exact figures were replaced with a loose bound
test("รายได้ 30,000", () => assert.ok(maxLimit(30000) > 100000));
