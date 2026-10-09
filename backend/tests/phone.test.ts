import { normalizePhone } from "../src/validation/register";

describe("normalizePhone", () => {
  test.each([
    ["0712345678", "254712345678"],
    ["0112345678", "254112345678"],
    ["+254712345678", "254712345678"],
    ["254712345678", "254712345678"],
    ["0712 345 678", "254712345678"],
    ["0712-345-678", "254712345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test.each(["", "12345", "0812345678", "07123456", "071234567890", "abcdefghij", "+255712345678"])(
    "rejects %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});
