"use client";

import { useRef } from "react";
import { Reveal } from "./Reveal";

/**
 * Giant outlined masthead wordmark. Letters rise and fill in with black
 * based on how close the cursor is, so moving across it sends a wave
 * through the word. Letters also rise one after another on first view.
 */
export function FooterWordmark({ text }: { text: string }) {
  const letters = useRef<(HTMLSpanElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const update = (x: number | null) => {
    // One reach for the whole word (a fraction of its width), so narrow and
    // wide letters react alike.
    const reach = (box.current?.getBoundingClientRect().width ?? 1000) * 0.18;
    letters.current.forEach((el) => {
      if (!el) return;
      let lift = 0;
      if (x !== null) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(x - (r.left + r.width / 2));
        lift = Math.max(0, 1 - dist / reach);
      }
      el.style.transform = `translateY(${(-lift * 9).toFixed(2)}%)`;
      el.style.color = `rgb(0 0 0 / ${(lift * 0.96).toFixed(3)})`;
      el.style.webkitTextStrokeColor = `rgb(${Math.round(217 - lift * 217)} ${Math.round(
        217 - lift * 217,
      )} ${Math.round(217 - lift * 217)})`;
    });
  };

  return (
    <Reveal className="mt-[-1.5rem]">
      <div
        ref={box}
        aria-label={text}
        role="img"
        onPointerMove={(e) => update(e.clientX)}
        onPointerLeave={() => update(null)}
        className="mx-auto w-[86%] max-w-[1560px] cursor-default select-none overflow-x-clip text-center text-[clamp(5rem,21vw,19rem)] [clip-path:inset(-0.3em_-1em_0_-1em)]"
        style={{ height: "0.6em" }}
      >
        <span aria-hidden="true" className="block leading-[0.9] tracking-[-0.06em]">
          {text.split("").map((ch, i) => (
            // outer span: entrance (rise in); inner span: cursor wave
            <span
              key={i}
              className="inline-block translate-y-[35%] opacity-0 transition-all duration-700 ease-out group-data-[shown=true]/reveal:translate-y-0 group-data-[shown=true]/reveal:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <span
                ref={(el) => {
                  letters.current[i] = el;
                }}
                className="inline-block font-extrabold text-transparent transition-[transform,color,-webkit-text-stroke-color] duration-200 ease-out [-webkit-text-stroke:1.5px_#d9d9d9] motion-reduce:transition-none"
              >
                {ch}
              </span>
            </span>
          ))}
        </span>
      </div>
    </Reveal>
  );
}
