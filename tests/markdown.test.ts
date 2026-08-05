import { describe, expect, it } from "vitest";
import { extractUrls, parseInline, parseMessage, toPlainText } from "@/shared/markdown";

const userId = "0f2b6a1c-8f3d-4a2e-9c1f-2b3d4e5f6a7b";

describe("message parsing", () => {
  it("parses emphasis, code and links", () => {
    const nodes = parseInline("*bold* _italic_ ~struck~ `code` https://example.com");
    expect(nodes.map((node) => node.type)).toEqual([
      "bold",
      "text",
      "italic",
      "text",
      "strike",
      "text",
      "code",
      "text",
      "link"
    ]);
  });

  it("keeps markdown-style emphasis working too", () => {
    const [node] = parseInline("**shipped**");
    expect(node).toEqual({ type: "bold", children: [{ type: "text", value: "shipped" }] });
  });

  it("resolves entity tokens", () => {
    const nodes = parseInline(`<@${userId}> <#${userId}|design> <!here> :rocket:`);
    expect(nodes[0]).toEqual({ type: "mention", userId });
    expect(nodes[2]).toEqual({ type: "channel", channelId: userId, name: "design" });
    expect(nodes[4]).toEqual({ type: "broadcast", name: "here" });
    expect(nodes[6]).toEqual({ type: "emoji", name: "rocket" });
  });

  it("does not treat code spans as formatting", () => {
    const nodes = parseInline("`a *b* c`");
    expect(nodes).toEqual([{ type: "code", value: "a *b* c" }]);
  });

  it("parses blocks: paragraphs, quotes, lists and code fences", () => {
    const blocks = parseMessage(["intro line", "", "> quoted", "- one", "- two", "```ts", "const a = 1;", "```"].join("\n"));
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "quote", "list", "codeblock"]);
    const list = blocks[2];
    expect(list.type === "list" && list.items).toHaveLength(2);
    const code = blocks[3];
    expect(code.type === "codeblock" && code.language).toBe("ts");
    expect(code.type === "codeblock" && code.value).toBe("const a = 1;");
  });

  it("numbers ordered lists separately from bullets", () => {
    const blocks = parseMessage("1. first\n2. second");
    expect(blocks[0].type === "list" && blocks[0].ordered).toBe(true);
  });

  it("renders plain text for notifications", () => {
    const text = `<@${userId}> shipped *it* — see <https://example.com|the plan>`;
    expect(toPlainText(text, { user: () => "Ada" })).toBe("@Ada shipped it — see the plan");
  });

  it("extracts urls from bare and wrapped links", () => {
    const urls = extractUrls("see https://a.example/path and <https://b.example|b>");
    expect(urls).toEqual(["https://a.example/path", "https://b.example"]);
  });
});
