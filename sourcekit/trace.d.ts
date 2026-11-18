export interface RgbaImage { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface TracedLine { points: [number, number][]; bolts?: [number, number][]; anchors?: [number, number][] }
/** Long edge (px) the photo is shrunk to before tracing. */
export const TRACE_EDGE: number;
/** Red (and yellow link) pen on the photo. Coordinates are multiplied by `scale` back to the original photo. */
export function traceRed(image: RgbaImage, scale?: number, expected?: number): TracedLine[];
/** Annotated photo minus the aligned original: any pen color, also bolts and anchors. */
export function traceDiff(annotated: RgbaImage, original: RgbaImage, scale?: number, expected?: number): TracedLine[];
/** Any pen color without an original photo: thin vivid lines grouped by hue (white only as a fallback). */
export function tracePen(image: RgbaImage, scale?: number, expected?: number, report?: object[]): TracedLine[];
/** White dashed pen: short thin bright segments chained into long, evenly spaced lines. `blocked` are areas to skip (white digits inside badges). */
export function traceDashes(image: RgbaImage, scale?: number, blocked?: { x: number; y: number; size: number }[]): TracedLine[];
/** Numbered route-start badges (flat colored rounded squares with a white number). Not OCR: order left to right. */
export function traceBadges(image: RgbaImage, scale?: number): { point: [number, number]; size: number; color: string; text: string }[];
/** Lines plus badges; each badge gets the nearby line whose start is closest (`line` = index into `lines`), or null when no line was found. */
export function traceTopo(image: RgbaImage, scale?: number, expected?: number): { lines: TracedLine[]; badges: { point: [number, number]; size: number; color: string; text: string; line: number | null }[] };
