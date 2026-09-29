import type { NodeId, OutlineDocument, OutlineNode } from "./types";

const indentOf = (line: string): number => {
  const prefix = line.match(/^[ \t]*/)?.[0] ?? "";
  return [...prefix].reduce((columns, char) => columns + (char === "\t" ? 1 : 1), 0);
};

export function parseOutline(text: string): OutlineDocument {
  const nodes: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((raw, line) => {
    if (!raw.trim()) return;
    const depth = indentOf(raw);
    const content = raw.trim();
    const marker = content.indexOf("=>");
    const label = (marker < 0 ? content : content.slice(0, marker)).trim();
    const annotation = marker < 0 ? undefined : content.slice(marker + 2).trim();
    if (!label) {
      if (annotation) {
        const target = [...nodes].reverse().find((candidate) => candidate.depth <= depth);
        if (target) target.annotation = target.annotation ? `${target.annotation}\n${annotation}` : annotation;
      }
      return;
    }

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.at(-1) ?? null;
    const node: OutlineNode = { id: `line-${line}`, label, annotation, depth, line, parentId: parent?.id ?? null, children: [] };
    parent?.children.push(node.id);
    nodes.push(node);
    stack.push(node);
  });

  return { text, nodes };
}
