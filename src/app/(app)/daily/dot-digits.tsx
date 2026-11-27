// Numbers drawn as a 5×7 dot matrix, like an LED panel. Plain SVG circles in currentColor: no web font to load, crisp
// at every size, and the real value is read out by screen readers through the label.
import { intlTag, type Locale } from '@/lib/i18n/locales';

/** Each glyph is 7 rows of lit (1) and dark (0) dots, top to bottom. */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ',': ['00', '00', '00', '00', '00', '01', '10'],
  ':': ['0', '0', '1', '0', '0', '1', '0'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
};
// Thousands separators and minus signs from Intl (narrow no-break spaces, the true minus) read as their plain twins.
const ALIASES: Record<string, string> = { ' ': ' ', ' ': ' ', ' ': ' ', '−': '-' };

export function DotDigits({
  text,
  dot = 3,
  gap = 1.6,
  ghost = 0.16,
  label,
  className,
}: {
  text: string;
  /** Dot diameter in px. */
  dot?: number;
  /** Space between dots in px. */
  gap?: number;
  /** Opacity of the dark dots (0 hides them). */
  ghost?: number;
  label?: string;
  className?: string;
}) {
  const pitch = dot + gap;
  const glyphs = [...text].map((ch) => GLYPHS[ALIASES[ch] ?? ch]).filter(Boolean);
  let x = 0;
  const lit: [number, number][] = [];
  const dark: [number, number][] = [];
  glyphs.forEach((rows, i) => {
    const cols = rows[0].length;
    rows.forEach((row, r) =>
      [...row].forEach((bit, c) => {
        const at: [number, number] = [x + c * pitch + dot / 2, r * pitch + dot / 2];
        (bit === '1' ? lit : dark).push(at);
      }),
    );
    x += cols * pitch + (i < glyphs.length - 1 ? pitch : 0);
  });
  const width = Math.max(x - gap, dot);
  const height = 7 * pitch - gap;
  return (
    <svg role="img" aria-label={label ?? text} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} style={{ overflow: 'visible' }}>
      {ghost > 0 && (
        <g opacity={ghost} aria-hidden>
          {dark.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={dot / 2} fill="currentColor" />
          ))}
        </g>
      )}
      <g aria-hidden>
        {lit.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={dot / 2} fill="currentColor" />
        ))}
      </g>
    </svg>
  );
}

export type DotFormat = 'int' | 'money' | 'pct' | 'signedPct';

export function formatDots(value: number, format: DotFormat, locale: Locale): string {
  if (format === 'pct' || format === 'signedPct') {
    const text = `${Math.abs(value).toFixed(1)}%`.replace('.', locale === 'pl' ? ',' : '.');
    return value < 0 ? `-${text}` : format === 'signedPct' && value > 0 ? `+${text}` : text;
  }
  return new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: 0 }).format(Math.round(value));
}
