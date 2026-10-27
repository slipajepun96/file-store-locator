import { useLayoutEffect, useRef } from 'react';

// Header/area/footer are designed for a 30mm-wide spine label; wide labels scale them
// by height instead so the main text keeps most of the space.
const DESIGN_WIDTH_MM = 30;
const DESIGN_WIDE_HEIGHT_MM = 60;
const MIN_FONT_MM = 2;
const PX_TO_MM = 25.4 / 96;

// A single label at the given physical size: a heading bar, a subtitle, the main text
// (scaled to fill the space) and a footer. Used for both file box and file labels.
// With subRatio, the subtitle is sized to that fraction of the main text instead of the fixed design size.
export default function Label({ head, sub, main, foot, widthMm, heightMm, subRatio }) {
  const subRef = useRef(null);
  const areaRef = useRef(null);
  const textRef = useRef(null);
  const vertical = heightMm > widthMm;
  const scale = vertical ? widthMm / DESIGN_WIDTH_MM : Math.min(heightMm / DESIGN_WIDE_HEIGHT_MM, widthMm / DESIGN_WIDTH_MM);

  // Start from the free space across the text and shrink the main text (and a linked subtitle) until both fit.
  useLayoutEffect(() => {
    const subEl = subRef.current;
    const area = areaRef.current;
    const text = textRef.current;
    const setSize = (s) => {
      text.style.fontSize = `${s}mm`;
      if (subRatio) subEl.style.fontSize = `${s * subRatio}mm`;
    };
    const fits = () =>
      text.offsetHeight <= area.clientHeight &&
      text.offsetWidth <= area.clientWidth &&
      (!subRatio || subEl.scrollWidth <= subEl.clientWidth);
    let size = (vertical ? area.clientWidth : area.clientHeight) * PX_TO_MM * 0.85;
    setSize(size);
    while (size > MIN_FONT_MM && !fits()) {
      size *= 0.95;
      setSize(size);
    }
  }, [main, sub, subRatio, widthMm, heightMm, scale, vertical]);

  return (
    <div
      className={`label ${vertical ? 'vertical' : 'horizontal'}`}
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, '--s': scale }}
    >
      <div className="label-head">{head}</div>
      <div className={`label-area${subRatio ? ' linked' : ''}`} ref={subRef}>{sub}</div>
      <div className="label-name" ref={areaRef}>
        <span ref={textRef}>{main}</span>
      </div>
      <div className="label-foot">{foot}</div>
    </div>
  );
}
