import { useEffect, useRef, useState, type CSSProperties } from 'react';

/*
  Drag to reorder, with the pointer (mouse, pen or touch). The picked-up item follows the pointer, lifted;
  the others slide aside to show where it will land; on release it glides into its slot and the new order is
  reported. Where it lands is decided by the pointer's position along the row against the other items'
  centres, so the first and last places are as easy to hit as any other.
*/

interface Snapshot { key: string; x: number; y: number; moved: boolean; start: Map<string, number>; size: Map<string, number>; gap: number; first: number }
interface Drag { key: string; dx: number; dy: number; order: string[]; dropping: boolean }

const MOVE = 'transform .2s cubic-bezier(.2,.7,.3,1)';

export function useSortable(keys: string[], axis: 'x' | 'y', onDrop: (next: string[]) => void) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const snap = useRef<Snapshot | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const swallow = useRef(false);
  // the snapshot is cleared on release, but the glide into place still needs it
  const lastSnap = useRef<Snapshot | null>(null);
  if (snap.current?.moved) lastSnap.current = snap.current;
  const live = useRef({ keys, onDrop });
  live.current = { keys, onDrop };

  /** where each item starts in a given order (the sizes and spacing measured when the drag began) */
  const layout = (s: Snapshot, order: string[]) => {
    const at = new Map<string, number>();
    let pos = s.first;
    for (const k of order) { at.set(k, pos); pos += (s.size.get(k) ?? 0) + s.gap; }
    return at;
  };
  const orderFor = (s: Snapshot, d: number) => {
    const ks = live.current.keys;
    const centre = (s.start.get(s.key) ?? 0) + (s.size.get(s.key) ?? 0) / 2 + d;
    const others = ks.filter(k => k !== s.key);
    const i = others.filter(k => (s.start.get(k) ?? 0) + (s.size.get(k) ?? 0) / 2 < centre).length;
    return [...others.slice(0, i), s.key, ...others.slice(i)];
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = snap.current;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        // measure everything once, as it is right now
        s.moved = true;
        const ks = live.current.keys;
        for (const k of ks) {
          const r = nodes.current.get(k)?.getBoundingClientRect();
          if (!r) continue;
          s.start.set(k, axis === 'x' ? r.left : r.top);
          s.size.set(k, axis === 'x' ? r.width : r.height);
        }
        const [a, b] = ks;
        s.first = s.start.get(a) ?? 0;
        s.gap = b ? (s.start.get(b) ?? 0) - (s.first + (s.size.get(a) ?? 0)) : 0;
        document.body.classList.add('sorting');
        getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      setDrag({ key: s.key, dx, dy, order: orderFor(s, axis === 'x' ? dx : dy), dropping: false });
    };
    const up = () => {
      const s = snap.current;
      snap.current = null;
      if (!s?.moved) return;
      document.body.classList.remove('sorting');
      // the click that ends a drag is not a click; it comes right after this, or not at all
      swallow.current = true;
      setTimeout(() => { swallow.current = false; }, 0);
      setDrag(d => {
        if (!d) return d;
        const order = d.order;
        // glide into the slot, then hand over the new order with no animation back
        setTimeout(() => {
          setSettling(true);
          setDrag(null);
          if (order.join('|') !== live.current.keys.join('|')) live.current.onDrop(order);
          requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
        }, 200);
        return { ...d, dropping: true };
      });
    };
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); document.body.classList.remove('sorting'); };
  }, [axis]);

  function style(key: string): CSSProperties {
    if (settling) return { transition: 'none' };
    const s = snap.current, d = drag;
    if (!d) return {};
    const snapNow = s ?? lastSnap.current;
    if (!snapNow) return {};
    const at = layout(snapNow, d.order);
    const shift = (at.get(key) ?? 0) - (snapNow.start.get(key) ?? 0);
    const t = (v: number) => (axis === 'x' ? `translate(${v}px, 0)` : `translate(0, ${v}px)`);
    if (key === d.key) {
      if (d.dropping) return { transform: t(shift), transition: MOVE, zIndex: 5, position: 'relative' };
      // lifted: follows the pointer along the row, a little across it
      const cross = Math.max(-10, Math.min(10, axis === 'x' ? d.dy : d.dx));
      const main = axis === 'x' ? d.dx : d.dy;
      return { transform: `${axis === 'x' ? `translate(${main}px, ${cross}px)` : `translate(${cross}px, ${main}px)`} scale(1.03)`, transition: 'box-shadow .15s', zIndex: 5, position: 'relative', cursor: 'grabbing' };
    }
    return { transform: t(shift), transition: MOVE };
  }
  return {
    /** spread on each item */
    item: (key: string) => ({
      ref: (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); },
      style: style(key),
      'data-lifted': drag?.key === key && !drag.dropping ? '' : undefined,
      onPointerDown: (e: React.PointerEvent) => {
        // buttons and fields inside an item keep working; the item itself may be a button
        const hit = (e.target as HTMLElement).closest('button, a, input, select, textarea, [data-nodrag]');
        if (e.button !== 0 || (hit && hit !== e.currentTarget)) return;
        snap.current = { key, x: e.clientX, y: e.clientY, moved: false, start: new Map(), size: new Map(), gap: 0, first: 0 };
      },
      onDragStart: (e: React.DragEvent) => e.preventDefault(),
    }),
    dragging: drag?.key ?? null,
    /** true right after a drag: the click that ends it should be ignored */
    clickWasDrag: () => swallow.current,
  };
}
