import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function TooltipBox({ anchor, side, tip }) {
  const boxRef = useRef(null);
  const [style, setStyle] = useState({ visibility: 'hidden', left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (side === 'right' || side === 'left') {
      top = anchor.cy - h / 2;
      top = Math.max(8, Math.min(top, vh - h - 8));
      left = side === 'right' ? anchor.right + 8 : anchor.left - w - 8;
      if (left < 8 || left + w > vw - 8) {
        left = Math.max(8, Math.min(anchor.cx - w / 2, vw - w - 8));
        top = anchor.bottom + 8;
        if (top + h > vh - 8) top = Math.max(8, anchor.top - h - 8);
      }
    } else {
      left = anchor.cx - w / 2;
      left = Math.max(8, Math.min(left, vw - w - 8));
      top = side === 'bottom' ? anchor.bottom + 8 : anchor.top - h - 8;
      if (top < 8) top = anchor.bottom + 8;
      if (top + h > vh - 8) top = Math.max(8, anchor.top - h - 8);
    }
    setStyle({ visibility: 'visible', left, top });
  }, [anchor, side]);

  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="pointer-events-none fixed z-[9999] max-w-[280px] whitespace-normal break-words rounded-md border border-white/10 bg-night-700 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-slate-200 shadow-xl shadow-black/50"
      style={style}
    >
      {tip}
    </div>,
    document.body
  );
}

export default function Tip({ tip, children, side = 'top', block = false, disabled = false }) {
  const ref = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const hideTimer = useRef(null);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setAnchor(null);
  }, []);

  const show = useCallback(() => {
    if (!tip) return;
    const el = ref.current;
    if (!el) return;
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    const r = el.getBoundingClientRect();
    setAnchor({
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right
    });
  }, [tip]);

  useEffect(() => {
    if (!anchor) return;
    const onHide = () => hide();
    window.addEventListener('scroll', onHide, true);
    window.addEventListener('resize', onHide);
    return () => {
      window.removeEventListener('scroll', onHide, true);
      window.removeEventListener('resize', onHide);
    };
  }, [anchor, hide]);

  useEffect(() => () => hide(), [hide]);

  if (!tip || disabled) return block ? <div>{children}</div> : <>{children}</>;

  return (
    <span
      ref={ref}
      className={`group/tip ${block ? 'block' : 'inline-flex max-w-full'}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor && <TooltipBox anchor={anchor} side={side} tip={tip} />}
    </span>
  );
}
