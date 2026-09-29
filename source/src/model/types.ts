export type NodeId = string;

export type OutlineNode = {
  id: NodeId;
  label: string;
  annotation?: string;
  depth: number;
  line: number;
  parentId: NodeId | null;
  children: NodeId[];
};

export type OutlineDocument = {
  text: string;
  nodes: OutlineNode[];
};
