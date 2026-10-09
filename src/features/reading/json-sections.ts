// 受控流式：从模型逐段输出的 JSON 文本里，切出"已经完整"的顶层字段。
// 只有完整的字段值会交给调用方去 JSON.parse + 校验，原始 token 永远不直接显示。

export interface Section {
  key: string;
  raw: string;
}

export class TopLevelSections {
  private buf = "";
  private i = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private expectKey = false;
  private keyStart = -1;
  private key: string | null = null;
  private valueStart = -1;

  push(chunk: string): Section[] {
    this.buf += chunk;
    const out: Section[] = [];
    for (; this.i < this.buf.length; this.i++) {
      const ch = this.buf[this.i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') {
          this.inString = false;
          if (this.keyStart >= 0) {
            this.key = JSON.parse(this.buf.slice(this.keyStart, this.i + 1)) as string;
            this.keyStart = -1;
          }
        }
        continue;
      }
      if (ch === '"') {
        this.inString = true;
        if (this.depth === 1 && this.expectKey) {
          this.keyStart = this.i;
          this.expectKey = false;
        }
        continue;
      }
      if (ch === "{" || ch === "[") {
        this.depth++;
        if (this.depth === 1) this.expectKey = true;
        continue;
      }
      if (this.depth === 1 && ch === ":" && this.key !== null) {
        this.valueStart = this.i + 1;
        continue;
      }
      if (this.depth === 1 && (ch === "," || ch === "}")) {
        if (this.key !== null && this.valueStart >= 0) {
          out.push({ key: this.key, raw: this.buf.slice(this.valueStart, this.i).trim() });
        }
        this.key = null;
        this.valueStart = -1;
        this.expectKey = ch === ",";
        if (ch === "}") this.depth--;
        continue;
      }
      if (ch === "}" || ch === "]") this.depth--;
    }
    return out;
  }
}
