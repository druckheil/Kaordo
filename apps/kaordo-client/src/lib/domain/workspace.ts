export type ObjectSummary = {
  document: ObjectDocument;
  id: string;
  title: string;
  type: string;
  warning?: string;
};

export type RichTextElement = {
  html: string;
  id: string;
  type: 'rich-text';
};

export type RectangleElement = {
  fill: string;
  height: number;
  id: string;
  parentObjectId?: string;
  radius: number;
  stroke: string;
  strokeWidth: number;
  type: 'rectangle';
  width: number;
  x: number;
  y: number;
};

export type ArrowAnchorSide = 'bottom' | 'left' | 'right' | 'top';

export type ArrowAttachment = {
  elementId?: string;
  objectId?: string;
  offset: number;
  side: ArrowAnchorSide;
};

export type ArrowControlPoint = {
  x: number;
  y: number;
};

export type ArrowHeadMode = 'both' | 'end' | 'none';

export type ArrowLineStyle = 'dashed' | 'dotted' | 'solid';

export type ArrowElement = {
  controlPoints: ArrowControlPoint[];
  endAttachment?: ArrowAttachment;
  endX: number;
  endY: number;
  headMode: ArrowHeadMode;
  height: number;
  id: string;
  parentObjectId?: string;
  startAttachment?: ArrowAttachment;
  startX: number;
  startY: number;
  stroke: string;
  strokeWidth: number;
  type: 'arrow';
  lineStyle: ArrowLineStyle;
  width: number;
  x: number;
  y: number;
};

export type TextElement = {
  color: string;
  fontSize: number;
  height: number;
  html: string;
  id: string;
  leftBars?: 1 | 2;
  parentElementId?: string;
  parentObjectId?: string;
  textAlign: 'center' | 'left' | 'right';
  type: 'text';
  width: number;
  x: number;
  y: number;
};

export type CanvasMediaKind = 'audio' | 'gif' | 'image' | 'video';

export type MediaElement = {
  height: number;
  id: string;
  kind: CanvasMediaKind;
  mediaId: string;
  mimeType: string;
  name: string;
  parentElementId?: string;
  parentObjectId?: string;
  size: number;
  type: 'media';
  width: number;
  x: number;
  y: number;
};

export type CanvasElement = ArrowElement | RectangleElement | TextElement | MediaElement;

export type ObjectDocumentElement = RectangleElement | RichTextElement;

export type ObjectFrame = {
  height: number;
  width: number;
};

export type ObjectDocument = {
  elements: ObjectDocumentElement[];
  frame?: ObjectFrame;
  version: 1;
};

export const EMPTY_OBJECT_DOCUMENT: ObjectDocument = {
  elements: [],
  version: 1,
};

export function copyObjectDocument(document: ObjectDocument): ObjectDocument {
  const copy: ObjectDocument = {
    elements: document.elements.map((element) => ({ ...element })),
    version: 1,
  };
  if (document.frame) copy.frame = { ...document.frame };
  return copy;
}

export function normalizeObjectDocument(value: unknown): ObjectDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.elements)) {
    return copyObjectDocument(EMPTY_OBJECT_DOCUMENT);
  }
  const elements: ObjectDocumentElement[] = [];
  for (const element of value.elements) {
    if (
      isRecord(element) &&
      element.type === 'rich-text' &&
      typeof element.id === 'string' &&
      typeof element.html === 'string'
    ) {
      elements.push({ html: element.html, id: element.id, type: 'rich-text' });
      continue;
    }
    const rectangle = normalizeRectangle(element);
    if (rectangle) elements.push(rectangle);
  }
  const document: ObjectDocument = { elements, version: 1 };
  const frame = value.frame;
  if (
    isRecord(frame) &&
    isFiniteNumber(frame.width) &&
    isFiniteNumber(frame.height)
  ) {
    document.frame = { height: frame.height, width: frame.width };
  }
  return document;
}

export function parseObjectDocument(serialized?: string | null): ObjectDocument {
  if (!serialized) return copyObjectDocument(EMPTY_OBJECT_DOCUMENT);
  try {
    return normalizeObjectDocument(JSON.parse(serialized));
  } catch {
    return copyObjectDocument(EMPTY_OBJECT_DOCUMENT);
  }
}

export function serializeObjectDocument(document: ObjectDocument): string {
  return JSON.stringify(normalizeObjectDocument(document));
}

export type WorkspaceSummary = {
  id: string;
  name: string;
  path: string;
  warning?: string;
};

export type WorkspaceDetail = WorkspaceSummary & {
  objects: ObjectSummary[];
  warnings: string[];
};

export type WorkspaceLibrary = {
  files: WorkspaceSummary[];
  warnings: string[];
};

export type WorkspaceCanvasDocument = {
  elements: CanvasElement[];
  placements: WorkspaceCanvasPlacement[];
  version: 1;
};

export type WorkspaceCanvasPlacement = {
  height: number;
  objectId: string;
  width: number;
  x: number;
  y: number;
};

/**
 * Returns every canvas element owned by a panel, including elements nested in
 * cards or other elements. Keeping this traversal in the domain layer makes
 * deletion and cleanup use the same hierarchy rules.
 */
export function canvasElementIdsForObject(
  document: WorkspaceCanvasDocument,
  objectId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const element of document.elements) {
    if (
      (element.type !== 'text' && element.type !== 'media') ||
      !element.parentElementId
    ) continue;
    const siblings = children.get(element.parentElementId) ?? [];
    siblings.push(element.id);
    children.set(element.parentElementId, siblings);
  }

  const ids = new Set<string>();
  const pending = document.elements
    .filter((element) => element.parentObjectId === objectId)
    .map((element) => element.id);
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return ids;
}

export function normalizeWorkspaceCanvasDocument(
  value: unknown,
): WorkspaceCanvasDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.elements)) {
    return { elements: [], placements: [], version: 1 };
  }
  return {
    elements: value.elements.flatMap((element) => {
      const normalized = normalizeCanvasElement(element);
      return normalized ? [normalized] : [];
    }),
    placements: Array.isArray(value.placements)
      ? value.placements.flatMap((placement) => {
          if (
            !isRecord(placement) ||
            typeof placement.objectId !== 'string' ||
            !isFiniteNumber(placement.x) ||
            !isFiniteNumber(placement.y) ||
            !isFiniteNumber(placement.width) ||
            !isFiniteNumber(placement.height)
          ) {
            return [];
          }
          return [{
            height: placement.height,
            objectId: placement.objectId,
            width: placement.width,
            x: placement.x,
            y: placement.y,
          }];
        })
      : [],
    version: 1,
  };
}

export function parseWorkspaceCanvasDocument(
  serialized?: string | null,
): WorkspaceCanvasDocument {
  if (!serialized) return { elements: [], placements: [], version: 1 };
  try {
    return normalizeWorkspaceCanvasDocument(JSON.parse(serialized));
  } catch {
    return { elements: [], placements: [], version: 1 };
  }
}

export function serializeWorkspaceCanvasDocument(
  document: WorkspaceCanvasDocument,
): string {
  return JSON.stringify(normalizeWorkspaceCanvasDocument(document));
}

export type WorkspaceDetailPayload = WorkspaceSummary & {
  objects?: ObjectSummaryPayload[] | null;
  warnings?: string[] | null;
};

export type ObjectSummaryPayload = Omit<ObjectSummary, 'document'> & {
  document?: ObjectDocument | null;
  documentJson?: string | null;
};

export type WorkspaceLibraryPayload = {
  files?: WorkspaceSummary[] | null;
  warnings?: string[] | null;
};

export function normalizeWorkspaceDetail(
  workspace: WorkspaceDetailPayload,
): WorkspaceDetail {
  const detail: WorkspaceDetail = {
    id: workspace.id,
    name: workspace.name,
    objects: (workspace.objects ?? []).map(normalizeObjectSummary),
    path: workspace.path,
    warnings: [...(workspace.warnings ?? [])],
  };
  if (workspace.warning !== undefined) detail.warning = workspace.warning;
  return detail;
}

export function normalizeObjectSummary(object: ObjectSummaryPayload): ObjectSummary {
  const normalized: ObjectSummary = {
    document: object.document
      ? normalizeObjectDocument(object.document)
      : parseObjectDocument(object.documentJson),
    id: object.id,
    title: object.title,
    type: object.type,
  };
  if (object.warning !== undefined) normalized.warning = object.warning;
  return normalized;
}

export function normalizeWorkspaceLibrary(
  library: WorkspaceLibraryPayload,
): WorkspaceLibrary {
  return {
    files: [...(library.files ?? [])],
    warnings: [...(library.warnings ?? [])],
  };
}

export function workspaceSummary(workspace: WorkspaceDetail): WorkspaceSummary {
  const summary: WorkspaceSummary = {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
  };
  if (workspace.warning !== undefined) summary.warning = workspace.warning;
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRectangle(value: unknown): RectangleElement | null {
  if (
    !isRecord(value) ||
    value.type !== 'rectangle' ||
    typeof value.id !== 'string' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !isFiniteNumber(value.radius) ||
    !isFiniteNumber(value.strokeWidth) ||
    typeof value.fill !== 'string' ||
    typeof value.stroke !== 'string'
  ) {
    return null;
  }
  const rectangle: RectangleElement = {
    fill: value.fill,
    height: value.height,
    id: value.id,
    radius: value.radius,
    stroke: value.stroke,
    strokeWidth: value.strokeWidth,
    type: 'rectangle',
    width: value.width,
    x: value.x,
    y: value.y,
  };
  if (typeof value.parentObjectId === 'string') {
    rectangle.parentObjectId = value.parentObjectId;
  }
  return rectangle;
}

function normalizeCanvasElement(value: unknown): CanvasElement | null {
  const rectangle = normalizeRectangle(value);
  if (rectangle) return rectangle;
  const arrow = normalizeArrow(value);
  if (arrow) return arrow;
  const media = normalizeMedia(value);
  if (media) return media;
  if (
    !isRecord(value) ||
    value.type !== 'text' ||
    typeof value.id !== 'string' ||
    typeof value.html !== 'string' ||
    typeof value.color !== 'string' ||
    !isFiniteNumber(value.fontSize) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !matchesTextAlign(value.textAlign)
  ) {
    return null;
  }
  const text: TextElement = {
    color: value.color,
    fontSize: value.fontSize,
    height: value.height,
    html: sanitizeTextHtml(value.html),
    id: value.id,
    textAlign: value.textAlign,
    type: 'text',
    width: value.width,
    x: value.x,
    y: value.y,
  };
  if (typeof value.parentObjectId === 'string') {
    text.parentObjectId = value.parentObjectId;
  }
  if (typeof value.parentElementId === 'string') {
    text.parentElementId = value.parentElementId;
  }
  if (matchesTextLeftBars(value.leftBars)) {
    text.leftBars = value.leftBars;
  }
  return text;
}

function normalizeArrow(value: unknown): ArrowElement | null {
  if (
    !isRecord(value) ||
    value.type !== 'arrow' ||
    typeof value.id !== 'string' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !isFiniteNumber(value.startX) ||
    !isFiniteNumber(value.startY) ||
    !isFiniteNumber(value.endX) ||
    !isFiniteNumber(value.endY) ||
    !isFiniteNumber(value.strokeWidth) ||
    typeof value.stroke !== 'string'
  ) {
    return null;
  }
  const legacyCurvature = isFiniteNumber(value.curvature)
    ? Math.max(-1, Math.min(1, value.curvature))
    : 0;
  const rawControlPoints = Array.isArray(value.controlPoints)
    ? value.controlPoints.flatMap((point) => {
        if (
          !isRecord(point) ||
          !isFiniteNumber(point.x) ||
          !isFiniteNumber(point.y)
        ) {
          return [];
        }
        return [{ x: point.x, y: point.y }];
      }).slice(0, 32)
    : null;
  const arrow: ArrowElement = {
    controlPoints: rawControlPoints ?? [
      legacyArrowControlPoint(
        { x: value.startX, y: value.startY },
        { x: value.endX, y: value.endY },
        legacyCurvature,
      ),
    ],
    endX: value.endX,
    endY: value.endY,
    headMode: matchesArrowHeadMode(value.headMode) ? value.headMode : 'end',
    height: Math.max(1, value.height),
    id: value.id,
    startX: value.startX,
    startY: value.startY,
    stroke: value.stroke,
    strokeWidth: Math.max(1, value.strokeWidth),
    type: 'arrow',
    lineStyle: matchesArrowLineStyle(value.lineStyle) ? value.lineStyle : 'solid',
    width: Math.max(1, value.width),
    x: value.x,
    y: value.y,
  };
  if (typeof value.parentObjectId === 'string') arrow.parentObjectId = value.parentObjectId;
  const startAttachment = normalizeArrowAttachment(value.startAttachment);
  if (startAttachment) arrow.startAttachment = startAttachment;
  const endAttachment = normalizeArrowAttachment(value.endAttachment);
  if (endAttachment) arrow.endAttachment = endAttachment;
  return arrow;
}

function matchesArrowHeadMode(value: unknown): value is ArrowHeadMode {
  return value === 'both' || value === 'end' || value === 'none';
}

function matchesArrowLineStyle(value: unknown): value is ArrowLineStyle {
  return value === 'dashed' || value === 'dotted' || value === 'solid';
}

function legacyArrowControlPoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  curvature: number,
): ArrowControlPoint {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 0.001 || Math.abs(curvature) < 0.001) {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  const bend = curvature * length * 0.45;
  return {
    x: (start.x + end.x) / 2 - (deltaY / length) * bend,
    y: (start.y + end.y) / 2 + (deltaX / length) * bend,
  };
}

function normalizeArrowAttachment(value: unknown): ArrowAttachment | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.offset) ||
    !matchesArrowAnchorSide(value.side) ||
    (typeof value.elementId !== 'string' && typeof value.objectId !== 'string')
  ) return null;
  const attachment: ArrowAttachment = {
    offset: Math.max(0, Math.min(1, value.offset)),
    side: value.side,
  };
  if (typeof value.elementId === 'string') attachment.elementId = value.elementId;
  if (typeof value.objectId === 'string') attachment.objectId = value.objectId;
  return attachment;
}

function normalizeMedia(value: unknown): MediaElement | null {
  if (
    !isRecord(value) ||
    value.type !== 'media' ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    !matchesCanvasMediaKind(value.kind) ||
    !isFiniteNumber(value.size) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y)
  ) {
    return null;
  }
  const media: MediaElement = {
    height: Math.max(1, value.height),
    id: value.id,
    kind: value.kind,
    mediaId: typeof value.mediaId === 'string' ? value.mediaId : value.id,
    mimeType: value.mimeType.slice(0, 160),
    name: value.name.slice(0, 240),
    size: Math.max(0, value.size),
    type: 'media',
    width: Math.max(1, value.width),
    x: value.x,
    y: value.y,
  };
  if (typeof value.parentObjectId === 'string') {
    media.parentObjectId = value.parentObjectId;
  }
  if (typeof value.parentElementId === 'string') {
    media.parentElementId = value.parentElementId;
  }
  return media;
}

function matchesCanvasMediaKind(value: unknown): value is CanvasMediaKind {
  return value === 'audio' || value === 'gif' || value === 'image' || value === 'video';
}

function matchesArrowAnchorSide(value: unknown): value is ArrowAnchorSide {
  return value === 'bottom' || value === 'left' || value === 'right' || value === 'top';
}

function matchesTextAlign(value: unknown): value is TextElement['textAlign'] {
  return value === 'left' || value === 'center' || value === 'right';
}

function matchesTextLeftBars(value: unknown): value is NonNullable<TextElement['leftBars']> {
  return value === 1 || value === 2;
}

export function sanitizeTextHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return escapeText(html);
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return '';
  sanitizeTextNode(root);
  return root.innerHTML.slice(0, 32_000);
}

export function textElementLabel(element: TextElement): string {
  if (typeof DOMParser === 'undefined') {
    return element.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled text';
  }
  const parsed = new DOMParser().parseFromString(element.html, 'text/html');
  return parsed.body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled text';
}

function sanitizeTextNode(root: Element): void {
  const allowed = new Set(['B', 'BR', 'DIV', 'EM', 'I', 'P', 'S', 'SPAN', 'STRIKE', 'STRONG', 'U']);
  for (const child of [...root.children]) {
    sanitizeTextNode(child);
    if (child.tagName === 'FONT') {
      const replacement = child.ownerDocument.createElement('span');
      const color = child.getAttribute('color');
      if (color) replacement.style.color = color;
      replacement.append(...child.childNodes);
      child.replaceWith(replacement);
      continue;
    }
    if (!allowed.has(child.tagName)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    const color = child instanceof HTMLElement ? child.style.color : '';
    const background = child instanceof HTMLElement ? child.style.backgroundColor : '';
    for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
    const styles = [
      color ? `color:${color}` : '',
      background ? `background-color:${background}` : '',
    ].filter(Boolean).join(';');
    if (styles) child.setAttribute('style', styles);
  }
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
