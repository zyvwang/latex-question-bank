const TRUNCATION_LABEL = "LaTeX output truncated";

export const MAX_LATEX_LOG_BYTES = 1024 * 1024;
export const MAX_LATEX_PROBE_BYTES = 64 * 1024;

export class BoundedOutput {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private totalBytes = 0;

  constructor(
    private readonly maxBytes: number,
    preferredHeadBytes = 64 * 1024
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 128) {
      throw new Error("Bounded output limit must be at least 128 bytes.");
    }
    this.headLimit = Math.min(preferredHeadBytes, Math.floor(maxBytes / 2));
    this.tailLimit = maxBytes - this.headLimit;
  }

  append(value: Uint8Array | string) {
    const chunk = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
    if (chunk.length === 0) return;
    this.totalBytes += chunk.length;

    let offset = 0;
    if (this.head.length < this.headLimit) {
      const headBytes = Math.min(
        this.headLimit - this.head.length,
        chunk.length
      );
      this.head = Buffer.concat([
        this.head,
        chunk.subarray(0, headBytes)
      ]);
      offset = headBytes;
    }
    if (offset >= chunk.length) return;

    const combined = Buffer.concat([this.tail, chunk.subarray(offset)]);
    this.tail = combined.length <= this.tailLimit
      ? combined
      : combined.subarray(combined.length - this.tailLimit);
  }

  toString(): string {
    const retainedBytes = this.head.length + this.tail.length;
    if (this.totalBytes <= retainedBytes) {
      return Buffer.concat([this.head, this.tail]).toString("utf8");
    }

    const marker = Buffer.from(
      `\n...[${TRUNCATION_LABEL}: ${this.totalBytes - retainedBytes} bytes omitted]...\n`
    );
    const availableDataBytes = Math.max(0, this.maxBytes - marker.length);
    const headBytes = Math.min(this.head.length, availableDataBytes);
    const tailBytes = Math.min(
      this.tail.length,
      availableDataBytes - headBytes
    );
    const omittedBytes = this.totalBytes - headBytes - tailBytes;
    const finalMarker = Buffer.from(
      `\n...[${TRUNCATION_LABEL}: ${omittedBytes} bytes omitted]...\n`
    );
    const adjustedTailBytes = Math.max(
      0,
      Math.min(this.tail.length, this.maxBytes - headBytes - finalMarker.length)
    );
    return Buffer.concat([
      this.head.subarray(0, headBytes),
      finalMarker,
      this.tail.subarray(this.tail.length - adjustedTailBytes)
    ]).toString("utf8");
  }
}
