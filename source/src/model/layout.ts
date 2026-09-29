import type { Doc, Point } from './document';
export type Size = { width: number; height: number };
export type Sizes = Record<string, Size>;
export function simulation(doc: Doc, sizes: Sizes, allowed?: Set<string>, distance = 180) {
  const nodes = doc.items;
  const positions = structuredClone(doc.positions);
  const offsets: Record<string, Point> = {}, group: Record<string, string> = {};
  nodes.forEach(n => {
    group[n.id] = n.parent && doc.locked[n.id] ? group[n.parent] : n.id;
    if (n.parent) offsets[n.id] = { x: positions[n.id].x - positions[n.parent].x, y: positions[n.id].y - positions[n.parent].y };
  });
  const velocities = Object.fromEntries(nodes.map(n => [n.id, { x: 0, y: 0 }]));
  const size = (id: string) => sizes[id] ?? { width: 140, height: 48 };
  const canMove = (id: string) => (!allowed || allowed.has(id)) && !(doc.locked[id] && !nodes.find(n => n.id === id)?.parent);
  let ticks = 0;
  return {
    tick() {
      const forces = Object.fromEntries(nodes.map(n => [n.id, { x: 0, y: 0 }]));
      function force(id: string, x: number, y: number) { const g = group[id]; if (canMove(g)) { forces[g].x += x; forces[g].y += y; } }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id, b = nodes[j].id;
        if (group[a] === group[b]) continue;
        const dx = positions[b].x - positions[a].x, dy = positions[b].y - positions[a].y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const ox = (size(a).width + size(b).width) / 2 + 22 - Math.abs(dx);
        const oy = (size(a).height + size(b).height) / 2 + 22 - Math.abs(dy);
        let fx = dx / d * Math.min(4, 1800 / (d * d)), fy = dy / d * Math.min(4, 1800 / (d * d));
        if (ox > 0 && oy > 0) {
          if (ox < oy) fx += (dx >= 0 ? 1 : -1) * ox * .28;
          else fy += (dy >= 0 ? 1 : -1) * oy * .28;
        }
        force(a, -fx, -fy); force(b, fx, fy);
      }
      nodes.forEach(n => {
        if (!n.parent || doc.locked[n.id]) return;
        const a = n.parent, b = n.id, dx = positions[b].x - positions[a].x, dy = positions[b].y - positions[a].y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const clearance = Math.abs(dx / d) * (size(a).width + size(b).width) / 2 + Math.abs(dy / d) * (size(a).height + size(b).height) / 2;
        const amount = (d - Math.max(distance, clearance + 55)) * .024;
        force(b, -dx / d * amount, -dy / d * amount); force(a, dx / d * amount, dy / d * amount);
      });
      let speed = 0;
      nodes.forEach(n => {
        if (group[n.id] !== n.id || !canMove(n.id)) return;
        const v = velocities[n.id]; v.x = (v.x + forces[n.id].x) * .62; v.y = (v.y + forces[n.id].y) * .62;
        positions[n.id].x += Math.max(-18, Math.min(18, v.x)); positions[n.id].y += Math.max(-18, Math.min(18, v.y));
        speed += Math.abs(v.x) + Math.abs(v.y);
      });
      // Parent order guarantees locked chains follow the parent's translation.
      nodes.forEach(n => {
        if (n.parent && doc.locked[n.id] && (!allowed || allowed.has(n.id))) {
          positions[n.id] = { x: positions[n.parent].x + offsets[n.id].x, y: positions[n.parent].y + offsets[n.id].y };
        }
      });
      ticks++;
      return { positions: structuredClone(positions), done: ticks >= 240 || ticks > 20 && speed < .09 };
    }
  };
}
